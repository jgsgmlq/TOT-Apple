'use strict';

const { BaseCheckpointSaver, TASKS, copyCheckpoint, maxChannelVersion } = require('@langchain/langgraph-checkpoint');
const mysql = require('../../../modules/common/db/mysql');

const checkpointMetadataKeys = ['source', 'step', 'parents'];
function validateKeys(keys) { return keys; }
const validCheckpointMetadataKeys = validateKeys(checkpointMetadataKeys);

/**
 * MysqlSaver — LangGraph 状态检查点的 MySQL 实现。
 *
 * 完全兼容 SqliteSaver 接口，底层用 mysql2 连接池。
 * 使用时传入 serde（默认 JsonPlusSerializer），构造函数不需要 db 参数。
 */
class MysqlSaver extends BaseCheckpointSaver {
  static #tablesEnsured = false;

  constructor(serde) {
    super(serde);
  }

  static async ensureTables() {
    if (MysqlSaver.#tablesEnsured) return;

    await mysql.query(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id VARCHAR(128) NOT NULL,
        checkpoint_ns VARCHAR(128) NOT NULL DEFAULT '',
        checkpoint_id VARCHAR(128) NOT NULL,
        parent_checkpoint_id VARCHAR(128),
        type VARCHAR(64),
        checkpoint LONGBLOB,
        metadata LONGBLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await mysql.query(`
      CREATE TABLE IF NOT EXISTS writes (
        thread_id VARCHAR(128) NOT NULL,
        checkpoint_ns VARCHAR(128) NOT NULL DEFAULT '',
        checkpoint_id VARCHAR(128) NOT NULL,
        task_id VARCHAR(128) NOT NULL,
        idx INT NOT NULL,
        channel VARCHAR(128) NOT NULL,
        type VARCHAR(64),
        value LONGBLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    MysqlSaver.#tablesEnsured = true;
  }

  async setup() {
    await MysqlSaver.ensureTables();
  }

  // ─── helpers ──────────────────────────────────────────────────────────

  _argsForGet(config) {
    const { thread_id, checkpoint_ns = '', checkpoint_id } = config.configurable ?? {};
    if (checkpoint_id) return { thread_id, checkpoint_ns, checkpoint_id, byId: true };
    return { thread_id, checkpoint_ns, byId: false };
  }

  async _getRow({ thread_id, checkpoint_ns, checkpoint_id, byId }) {
    const sql = byId
      ? `
        SELECT c.*,
          (SELECT JSON_ARRAYAGG(JSON_OBJECT('task_id', pw.task_id, 'channel', pw.channel, 'type', pw.type, 'value', CAST(pw.value AS CHAR)))
           FROM writes pw
           WHERE pw.thread_id = c.thread_id AND pw.checkpoint_ns = c.checkpoint_ns AND pw.checkpoint_id = c.checkpoint_id
          ) AS pending_writes,
          (SELECT JSON_ARRAYAGG(JSON_OBJECT('type', ps.type, 'value', CAST(ps.value AS CHAR)))
           FROM writes ps
           WHERE ps.thread_id = c.thread_id AND ps.checkpoint_ns = c.checkpoint_ns AND ps.checkpoint_id = c.parent_checkpoint_id
             AND ps.channel = '${TASKS}'
           ORDER BY ps.idx
          ) AS pending_sends
        FROM checkpoints c
        WHERE c.thread_id = ? AND c.checkpoint_ns = ? AND c.checkpoint_id = ?
      `
      : `
        SELECT c.*,
          (SELECT JSON_ARRAYAGG(JSON_OBJECT('task_id', pw.task_id, 'channel', pw.channel, 'type', pw.type, 'value', CAST(pw.value AS CHAR)))
           FROM writes pw
           WHERE pw.thread_id = c.thread_id AND pw.checkpoint_ns = c.checkpoint_ns AND pw.checkpoint_id = c.checkpoint_id
          ) AS pending_writes,
          (SELECT JSON_ARRAYAGG(JSON_OBJECT('type', ps.type, 'value', CAST(ps.value AS CHAR)))
           FROM writes ps
           WHERE ps.thread_id = c.thread_id AND ps.checkpoint_ns = c.checkpoint_ns AND ps.checkpoint_id = c.parent_checkpoint_id
             AND ps.channel = '${TASKS}'
           ORDER BY ps.idx
          ) AS pending_sends
        FROM checkpoints c
        WHERE c.thread_id = ? AND c.checkpoint_ns = ?
        ORDER BY c.checkpoint_id DESC
        LIMIT 1
      `;

    const params = byId
      ? [thread_id, checkpoint_ns, checkpoint_id]
      : [thread_id, checkpoint_ns];

    const rows = await mysql.query(sql, params);
    return rows[0] ?? null;
  }

  async _parseRow(row) {
    let pendingWrites = [];
    if (row.pending_writes) {
      const raw = typeof row.pending_writes === 'string' ? JSON.parse(row.pending_writes) : row.pending_writes;
      pendingWrites = await Promise.all((raw || []).map(async (write) => {
        return [write.task_id, write.channel, await this.serde.loadsTyped(write.type ?? 'json', write.value ?? '')];
      }));
    }

    const checkpoint = await this.serde.loadsTyped(row.type ?? 'json', row.checkpoint);
    const metadata = await this.serde.loadsTyped(row.type ?? 'json', row.metadata);

    if (checkpoint.v < 4 && row.parent_checkpoint_id != null) {
      await this.migratePendingSends(checkpoint, row.thread_id, row.parent_checkpoint_id);
    }

    return { row, checkpoint, metadata, pendingWrites };
  }

  // ─── BaseCheckpointSaver API ──────────────────────────────────────────

  async getTuple(config) {
    await this.setup();
    const args = this._argsForGet(config);
    const row = await this._getRow(args);
    if (!row) return undefined;

    const { checkpoint, metadata, pendingWrites } = await this._parseRow(row);

    let finalConfig = config;
    if (!args.byId) {
      finalConfig = {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: args.checkpoint_ns,
          checkpoint_id: row.checkpoint_id,
        },
      };
    }

    return {
      config: finalConfig,
      checkpoint,
      metadata,
      parentConfig: row.parent_checkpoint_id
        ? { configurable: { thread_id: row.thread_id, checkpoint_ns: args.checkpoint_ns, checkpoint_id: row.parent_checkpoint_id } }
        : undefined,
      pendingWrites,
    };
  }

  async *list(config, options) {
    await this.setup();
    const { limit, before, filter } = options ?? {};
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns;

    let where = [];
    const params = [];

    if (thread_id) { where.push('c.thread_id = ?'); params.push(thread_id); }
    if (checkpoint_ns !== undefined && checkpoint_ns !== null) { where.push('c.checkpoint_ns = ?'); params.push(checkpoint_ns); }
    if (before?.configurable?.checkpoint_id !== undefined) { where.push('c.checkpoint_id < ?'); params.push(before.configurable.checkpoint_id); }

    const sanitizedFilter = Object.fromEntries(
      Object.entries(filter ?? {}).filter(([key, value]) => value !== undefined && validCheckpointMetadataKeys.includes(key))
    );
    for (const [key, value] of Object.entries(sanitizedFilter)) {
      where.push(`JSON_UNQUOTE(JSON_EXTRACT(CAST(c.metadata AS CHAR), '$.${key}')) = ?`);
      params.push(JSON.stringify(value));
    }

    let sql = `
      SELECT c.*,
        (SELECT JSON_ARRAYAGG(JSON_OBJECT('task_id', pw.task_id, 'channel', pw.channel, 'type', pw.type, 'value', CAST(pw.value AS CHAR)))
         FROM writes pw
         WHERE pw.thread_id = c.thread_id AND pw.checkpoint_ns = c.checkpoint_ns AND pw.checkpoint_id = c.checkpoint_id
        ) AS pending_writes,
        (SELECT JSON_ARRAYAGG(JSON_OBJECT('type', ps.type, 'value', CAST(ps.value AS CHAR)))
         FROM writes ps
         WHERE ps.thread_id = c.thread_id AND ps.checkpoint_ns = c.checkpoint_ns AND ps.checkpoint_id = c.parent_checkpoint_id
           AND ps.channel = '${TASKS}'
         ORDER BY ps.idx
        ) AS pending_sends
      FROM checkpoints c
    `;

    if (where.length > 0) sql += 'WHERE ' + where.join(' AND ') + '\n';
    sql += 'ORDER BY c.checkpoint_id DESC';
    if (limit) sql += ` LIMIT ${parseInt(limit, 10)}`;

    const rows = await mysql.query(sql, params);
    for (const row of rows) {
      const { checkpoint, metadata, pendingWrites } = await this._parseRow(row);
      yield {
        config: { configurable: { thread_id: row.thread_id, checkpoint_ns: row.checkpoint_ns, checkpoint_id: row.checkpoint_id } },
        checkpoint,
        metadata,
        parentConfig: row.parent_checkpoint_id
          ? { configurable: { thread_id: row.thread_id, checkpoint_ns: row.checkpoint_ns, checkpoint_id: row.parent_checkpoint_id } }
          : undefined,
        pendingWrites,
      };
    }
  }

  async put(config, checkpoint, metadata) {
    await this.setup();
    if (!config.configurable) throw new Error('Empty configuration supplied.');

    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns ?? '';
    const parent_checkpoint_id = config.configurable?.checkpoint_id;

    if (!thread_id) throw new Error('Missing "thread_id" field in passed "config.configurable".');

    const preparedCheckpoint = copyCheckpoint(checkpoint);
    const [[type1, serializedCheckpoint], [type2, serializedMetadata]] = await Promise.all([
      this.serde.dumpsTyped(preparedCheckpoint),
      this.serde.dumpsTyped(metadata),
    ]);

    if (type1 !== type2) throw new Error('Failed to serialize checkpoint and metadata to the same type.');

    await mysql.run(
      `REPLACE INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [thread_id, checkpoint_ns, checkpoint.id, parent_checkpoint_id, type1, serializedCheckpoint, serializedMetadata]
    );

    return {
      configurable: { thread_id, checkpoint_ns, checkpoint_id: checkpoint.id },
    };
  }

  async putWrites(config, writes, taskId) {
    await this.setup();
    if (!config.configurable) throw new Error('Empty configuration supplied.');
    if (!config.configurable?.thread_id) throw new Error('Missing thread_id field in config.configurable.');
    if (!config.configurable?.checkpoint_id) throw new Error('Missing checkpoint_id field in config.configurable.');

    const rows = await Promise.all(writes.map(async (write, idx) => {
      const [type, serializedWrite] = await this.serde.dumpsTyped(write[1]);
      return [
        config.configurable?.thread_id,
        config.configurable?.checkpoint_ns,
        config.configurable?.checkpoint_id,
        taskId,
        idx,
        write[0],
        type,
        serializedWrite,
      ];
    }));

    const sql = `REPLACE INTO writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
                 VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`;
    await mysql.run(sql, rows.flat());
  }

  async deleteThread(threadId) {
    await this.setup();
    await mysql.run('DELETE FROM checkpoints WHERE thread_id = ?', [threadId]);
    await mysql.run('DELETE FROM writes WHERE thread_id = ?', [threadId]);
  }

  async migratePendingSends(checkpoint, threadId, parentCheckpointId) {
    const rows = await mysql.query(
      `SELECT
         checkpoint_id,
         JSON_ARRAYAGG(JSON_OBJECT('type', ps.type, 'value', CAST(ps.value AS CHAR))) AS pending_sends
       FROM writes ps
       WHERE ps.thread_id = ? AND ps.checkpoint_id = ? AND ps.channel = '${TASKS}'
       ORDER BY ps.idx`,
      [threadId, parentCheckpointId]
    );
    const row = rows[0];
    if (!row || !row.pending_sends) return;

    checkpoint.channel_values ??= {};
    const sends = typeof row.pending_sends === 'string' ? JSON.parse(row.pending_sends) : row.pending_sends;
    checkpoint.channel_values[TASKS] = await Promise.all(
      (sends || []).map(({ type, value }) => this.serde.loadsTyped(type, value))
    );
    checkpoint.channel_versions[TASKS] = Object.keys(checkpoint.channel_versions).length > 0
      ? maxChannelVersion(...Object.values(checkpoint.channel_versions))
      : this.getNextVersion(undefined);
  }
}

module.exports = { MysqlSaver };

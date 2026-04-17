'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const asrService = require('../services/asrService');

const router = express.Router();

/**
 * POST /api/v1/asr/transcribe
 * Body: { audioUrl } | { audioBase64, audioMimeType? }, optional language, enableItn
 */
router.post('/transcribe', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
  try {
    const { audioUrl, audioBase64, audioMimeType, language, enableItn } = req.body || {};

    const hasUrl = typeof audioUrl === 'string' && audioUrl.trim() !== '';
    const hasB64 = typeof audioBase64 === 'string' && audioBase64.trim() !== '';

    if (hasUrl === hasB64) {
      return next(createError(400, '请提供 audioUrl 或 audioBase64 之一', 'ASR_004'));
    }

    let audioData;
    if (hasUrl) {
      audioData = audioUrl.trim();
    } else {
      const mime = typeof audioMimeType === 'string' && audioMimeType.trim()
        ? audioMimeType.trim()
        : 'audio/wav';
      const b64 = audioBase64.trim().replace(/^data:[^;]+;base64,/, '');
      audioData = `data:${mime};base64,${b64}`;
    }

    const result = await asrService.transcribe({
      audioData,
      language,
      enableItn,
    });

    res.json({
      code: 200,
      message: 'success',
      data: {
        text: result.text,
        model: result.model,
        ...(result.raw ? { raw: result.raw } : {}),
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

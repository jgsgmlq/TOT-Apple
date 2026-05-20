'use strict';

const express = require('express');
const { authenticate } = require('../../common/middleware/auth');
const campaignCrud = require('../crud/taskMysqlCrud');

const router = express.Router();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { fiscalYear, quarterNo, limit, offset } = req.query;
    const rows = await campaignCrud.getCampaignList({ fiscalYear, quarterNo, limit: parseInt(limit) || 200, offset: parseInt(offset) || 0 });
    res.json({
      code: 200, message: 'success',
      data: rows.map(c => ({
        activity_id:    c.activity_id,
        fiscal_year:    c.fiscal_year,
        quarter_no:     c.quarter_no,
        task_week:      c.task_week,
        topic_name:     c.topic_name,
        model_type:     c.model_type,
        date_range:     c.date_range,
        month_or_period: c.month_or_period,
      })),
      requestId: req.requestId,
    });
  } catch (err) { next(err); }
});

module.exports = router;

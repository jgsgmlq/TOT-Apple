'use strict';

var learnerCrud = require('../crud/learnerCrud');

function getLearnerList(o) { return learnerCrud.getLearnerList(o); }
function getLearnerById(id) { var l = learnerCrud.getLearnerById(id); if (!l) { var e = new Error('学员不存在'); e.status = 400; throw e; } return l; }
function getLearnerByEmail(email) { return learnerCrud.getLearnerByEmail(email); }
function getLearnerPage(o) { return learnerCrud.getLearnerPage(o); }

module.exports = { getLearnerList: getLearnerList, getLearnerById: getLearnerById, getLearnerByEmail: getLearnerByEmail, getLearnerPage: getLearnerPage };

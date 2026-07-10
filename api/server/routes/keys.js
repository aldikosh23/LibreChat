const express = require('express');
const { isServerManagedKeyName } = require('librechat-data-provider');
const { updateUserKey, deleteUserKey, getUserKeyExpiry } = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

router.put('/', requireJwtAuth, async (req, res) => {
  if (req.body == null || typeof req.body !== 'object') {
    return res.status(400).send({ error: 'Invalid request body.' });
  }
  const { name, value, expiresAt } = req.body;
  if (isServerManagedKeyName(name)) {
    return res.status(403).send({ error: 'Server-managed keys cannot be changed.' });
  }
  await updateUserKey({ userId: req.user.id, name, value, expiresAt });
  res.status(201).send();
});

router.delete('/:name', requireJwtAuth, async (req, res) => {
  const { name } = req.params;
  if (isServerManagedKeyName(name)) {
    return res.status(403).send({ error: 'Server-managed keys cannot be changed.' });
  }
  await deleteUserKey({ userId: req.user.id, name });
  res.status(204).send();
});

router.delete('/', requireJwtAuth, async (req, res) => {
  const { all } = req.query;

  if (all !== 'true') {
    return res.status(400).send({ error: 'Specify either all=true to delete.' });
  }
  return res.status(403).send({ error: 'Bulk key deletion is disabled.' });
});

router.get('/', requireJwtAuth, async (req, res) => {
  const { name } = req.query;
  const response = await getUserKeyExpiry({ userId: req.user.id, name });
  res.status(200).send(response);
});

module.exports = router;

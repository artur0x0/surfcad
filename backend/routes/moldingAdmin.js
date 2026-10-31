// routes/moldingAdmin.js — admin CRUD for the molding catalog.
// Mounted only under /api/admin/molding. displayName stays on this route.
import { Router } from 'express';
import MoldingPartner from '../db/models/MoldingPartner.js';
import MoldingMachine from '../db/models/MoldingMachine.js';
import MoldingResinPrice from '../db/models/MoldingResinPrice.js';
import MoldingToolingRate from '../db/models/MoldingToolingRate.js';
import MoldingLead from '../db/models/MoldingLead.js';
import MoldingResin from '../db/models/MoldingResin.js';
import * as catalog from '../services/moldingCatalog.js';
import * as leadAdmin from '../services/moldingLeadAdmin.js';
import * as resinLibrary from '../services/moldingResinLibrary.js';

function defaultModels() {
  return {
    partners: MoldingPartner,
    machines: MoldingMachine,
    resins: MoldingResinPrice,
    rates: MoldingToolingRate,
    leads: MoldingLead,
    library: MoldingResin,
  };
}

function sendError(res, error) {
  if (error instanceof catalog.CatalogError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error?.name === 'ValidationError') {
    const first = Object.values(error.errors || {})[0];
    return res.status(400).json({ error: first?.message || 'Invalid catalog row' });
  }
  if (error?.code === 11000) {
    return res.status(400).json({ error: 'That catalog row already exists' });
  }
  if (error?.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid catalog row' });
  }
  console.error('[Admin] molding catalog error:', error);
  return res.status(500).json({ error: 'Failed to save catalog' });
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      sendError(res, error);
    }
  };
}

/**
 * @param {ReturnType<typeof defaultModels>} [models]
 */
export function createMoldingAdminRouter(models = defaultModels()) {
  const db = models || defaultModels();
  const router = Router();

  router.get('/partners', wrap(async (req, res) => {
    const partners = await catalog.listPartners(db.partners, req.query);
    res.json({ partners });
  }));

  router.post('/partners', wrap(async (req, res) => {
    const partner = await catalog.createPartner(db.partners, req.body);
    res.status(201).json(partner);
  }));

  router.patch('/partners/:id', wrap(async (req, res) => {
    const partner = await catalog.updatePartner(db.partners, req.params.id, req.body);
    res.json(partner);
  }));

  router.post('/partners/:id/deactivate', wrap(async (req, res) => {
    const partner = await catalog.deactivate(db.partners, req.params.id);
    res.json(partner);
  }));

  router.get('/machines', wrap(async (req, res) => {
    const machines = await catalog.listMachines(db.machines, req.query);
    res.json({ machines });
  }));

  router.post('/machines', wrap(async (req, res) => {
    const machine = await catalog.createMachine(db, req.body);
    res.status(201).json(machine);
  }));

  router.patch('/machines/:id', wrap(async (req, res) => {
    const machine = await catalog.updateMachine(db, req.params.id, req.body);
    res.json(machine);
  }));

  router.post('/machines/:id/deactivate', wrap(async (req, res) => {
    const machine = await catalog.deactivate(db.machines, req.params.id);
    res.json(machine);
  }));

  router.get('/resins', wrap(async (req, res) => {
    const resins = await catalog.listResins(db.resins, req.query);
    res.json({ resins });
  }));

  router.post('/resins', wrap(async (req, res) => {
    const resin = await catalog.createResin(db, req.body);
    res.status(201).json(resin);
  }));

  router.patch('/resins/:id', wrap(async (req, res) => {
    const resin = await catalog.updateResin(db, req.params.id, req.body);
    res.json(resin);
  }));

  router.post('/resins/:id/deactivate', wrap(async (req, res) => {
    const resin = await catalog.deactivate(db.resins, req.params.id);
    res.json(resin);
  }));

  router.get('/rates', wrap(async (req, res) => {
    const rates = await catalog.listRates(db.rates, req.query);
    res.json({ rates });
  }));

  router.post('/rates', wrap(async (req, res) => {
    const rate = await catalog.createRate(db, req.body);
    res.status(201).json(rate);
  }));

  router.patch('/rates/:id', wrap(async (req, res) => {
    const rate = await catalog.updateRate(db, req.params.id, req.body);
    res.json(rate);
  }));

  router.post('/rates/:id/deactivate', wrap(async (req, res) => {
    const rate = await catalog.deactivate(db.rates, req.params.id);
    res.json(rate);
  }));

  router.get('/leads', wrap(async (req, res) => {
    const leads = await leadAdmin.listMoldingLeads(db, req.query);
    res.json({ leads });
  }));

  router.patch('/leads/:id', wrap(async (req, res) => {
    const lead = await leadAdmin.updateMoldingLead(db, req.params.id, req.body);
    res.json(lead);
  }));

  router.get('/resin-library', wrap(async (req, res) => {
    const resins = await resinLibrary.listMoldingResins(db.library, req.query);
    res.json({ resins });
  }));

  router.post('/resin-library', wrap(async (req, res) => {
    const resin = await resinLibrary.createMoldingResin(db.library, req.body);
    res.status(201).json(resin);
  }));

  router.patch('/resin-library/:id', wrap(async (req, res) => {
    const resin = await resinLibrary.updateMoldingResin(db.library, req.params.id, req.body);
    res.json(resin);
  }));

  router.post('/resin-library/:id/deactivate', wrap(async (req, res) => {
    const resin = await catalog.deactivate(db.library, req.params.id);
    res.json(resin);
  }));

  return router;
}

// routes/quotes.js - persist a measured quote (7-day TTL)
import { Router } from 'express';
import crypto from 'crypto';
import Quote from '../db/models/Quote.js';
import { requireAuth } from '../auth/session.js';
import { measureExportedPart } from '../services/measurePart.js';
import { quoteFromGeometry } from '../../src/utils/quoteMath.js';

const router = Router();

/**
 * POST /api/quotes
 * Measure the exported 3MF and store the unit price plus the file.
 * Client volume is ignored. Quantity on the quote is 1; the cart line holds qty.
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { scriptHash, process, material, infill, modelFile } = req.body || {};
    if (!scriptHash || !process || !material) {
      return res.status(400).json({ error: 'scriptHash, process, and material are required' });
    }
    const file = modelFile || req.body?.['model-file'];
    if (!file?.data && !file?.['data']) {
      return res.status(400).json({ error: 'Model file is required' });
    }

    const measured = await measureExportedPart({ modelFile: file });
    if (!measured.ok) {
      console.error('[Quotes] Rejected:', measured.detail || measured.error);
      return res.status(measured.status || 400).json({ error: measured.error });
    }

    const fill = infill == null || infill === '' ? 20 : Number(infill);
    if (!Number.isFinite(fill) || fill < 10 || fill > 100) {
      return res.status(400).json({ error: 'Infill must be between 10 and 100' });
    }

    let unit;
    try {
      unit = quoteFromGeometry({
        volume: measured.geometry.volume,
        boundingBox: measured.geometry.boundingBox,
        process,
        material,
        infill: fill,
        quantity: 1,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const quote = new Quote({
      'user-id': req.user._id,
      quoteId: crypto.randomUUID(),
      quotedAt: new Date(),
      quotedUnitPrice: unit.unitSubtotal,
      scriptHash,
      process,
      material,
      infill: fill,
      'volume-mm3': unit.volume,
      'bounding-box': {
        width: measured.geometry.boundingBox.width,
        height: measured.geometry.boundingBox.height,
        depth: measured.geometry.boundingBox.depth,
      },
      'unit-material': unit.unitMaterial,
      'unit-machine': unit.unitMachine,
      'unit-grams': unit.unitGrams,
      'model-file': {
        filename: file.filename || file['filename'] || 'part.3mf',
        'content-type': file.contentType || file['content-type'] || 'model/3mf',
        'storage-type': 'inline',
        data: file.data || file['data'],
      },
    });
    await quote.save();

    console.log(`[Quotes] Stored ${quote.quoteId} for user ${req.user._id}`);

    return res.status(201).json({
      success: true,
      quoteId: quote.quoteId,
      quotedAt: quote.quotedAt,
      quotedUnitPrice: quote.quotedUnitPrice,
      scriptHash: quote.scriptHash,
      process: quote.process,
      material: quote.material,
      infill: quote.infill,
      unitMaterial: quote['unit-material'],
      unitMachine: quote['unit-machine'],
      unitGrams: quote['unit-grams'],
      volume: quote['volume-mm3'],
      boundingBox: quote['bounding-box'],
    });
  } catch (error) {
    console.error('[Quotes] Create error:', error);
    return res.status(500).json({
      error: 'Failed to store quote',
      details: error.message,
    });
  }
});

export default router;

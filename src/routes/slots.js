// src/routes/slots.js
import express from "express";
import { requireJwt } from "../../middleware/requireJwt.js";

import {
  spinSlot, getActiveSlots, getOutcomes, getSlotsHistory,
  getInventory, claimInventory
} from "../controllers/slot/slots.js";

const r = express.Router();

r.get("/slots/active", getActiveSlots);
r.get("/slots/outcomes", getOutcomes);

r.post("/slots/spin", requireJwt, spinSlot);
r.get("/slots/history", requireJwt, getSlotsHistory);

r.get("/inventory", requireJwt, getInventory);
r.post("/inventory/:id/claim", requireJwt, claimInventory);

export default r;

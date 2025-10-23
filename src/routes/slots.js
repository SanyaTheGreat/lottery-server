// src/routes/slots.js
import express from "express";
import { requireJwt } from "../middleware/requireJwt.js";

import {
  spinSlot,
  getActiveSlots,
  getOutcomes,
  getSlotsHistory,
} from "../controllers/slot/slots.js";

import {
  getInventory,
  claimInventory,
} from "../controllers/slot/inventory.js";

const r = express.Router();

// публичные
r.get("/slots/active", getActiveSlots);
r.get("/slots/outcomes", getOutcomes);

// защищённые (JWT)
r.post("/slots/spin", requireJwt(), spinSlot);
r.get("/slots/history", requireJwt(), getSlotsHistory);

r.get("/inventory", requireJwt(), getInventory);
r.post("/inventory/:id/claim", requireJwt(), claimInventory);

export default r;

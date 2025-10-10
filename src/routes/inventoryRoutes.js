import { Router } from "express";
import { getInventory } from "../controllers/case/inventoryController.js";

const router = Router();

// GET /api/inventory
router.get("/inventory", getInventory);

export default router;

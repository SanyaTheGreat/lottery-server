import { Router } from "express";
import { getInventory } from "../controllers/case/inventoryController.js";
import { requireJwt } from "../middleware/requireJwt.js";

const router = Router();

// ✅ GET /api/inventory — теперь получает telegram_id из JWT, а не из query
router.get("/inventory", requireJwt(), getInventory);

export default router;

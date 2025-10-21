import express from "express";
import { createSlot } from "../controllers/slot/admin.js";

const router = express.Router();

// ✅ Создать слот (только по GEM_KEY, без JWT)
router.post("/admin/slots", createSlot);

export default router;

import { Router } from "express";
import { createCase, getCases } from "../controllers/case/casesController.js";
import { getFreeSpinAvailability } from "../controllers/case/freeSpinController.js"; // 👈 добавляем

const router = Router();

router.post("/cases", createCase);
router.get("/cases", getCases);


router.get("/free-spin/availability", getFreeSpinAvailability);

export default router;

import { Router } from "express";
import { createCase, getCases } from "../controllers/case/casesController.js";
import { getFreeSpinAvailability } from "../controllers/case/freeSpinController.js"; // 👈 добавляем
import { requireJwt } from "../middleware/requireJwt.js";

const router = Router();

router.post("/cases", createCase);
router.get("/cases", getCases);


router.get("/free-spin/availability", requireJwt(), getFreeSpinAvailability);

export default router;

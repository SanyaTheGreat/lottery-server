import { Router } from "express";
import { addCaseChance, getCaseChance } from "../controllers/case/caseChanceController.js";

const router = Router();

// создать запись шанса для кейса
router.post("/cases/:case_id/chance", addCaseChance);

// получить все шансы по кейсу
router.get("/cases/:case_id/chance", getCaseChance);

export default router;

import { Router } from "express";
import { addCaseItem, getCaseItems } from "../controllers/case/caseItemController.js";

const router = Router();

// добавить предмет в кейс
router.post("/case-items", addCaseItem);

// получить предметы кейса
router.get("/case-items/:case_id", getCaseItems);

export default router;

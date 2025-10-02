import { Router } from "express";
import { createCase, getCases } from "../controllers/case/caseController.js";

const router = Router();

 
router.post("/cases", createCase);

 
router.get("/cases", getCases);

export default router;

import { Router } from "express";
import { spinCase, rerollPrize, claimPrize } from "../controllers/case/caseSpinController.js";

const router = Router();

router.post("/case/spin", spinCase);
router.post("/case/spin/:id/reroll", rerollPrize);
router.post("/case/spin/:id/claim", claimPrize);

export default router;

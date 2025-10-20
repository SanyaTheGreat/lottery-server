import { Router } from "express";
import { spinCase, rerollPrize, claimPrize } from "../controllers/case/caseSpinController.js";
import { requireJwt } from "../middleware/requireJwt.js";

const router = Router();

// Все три эндпоинта требуют валидный JWT (берём telegram_id из req.user)
router.post("/case/spin", requireJwt(), spinCase);
router.post("/case/spin/:id/reroll", requireJwt(), rerollPrize);
router.post("/case/spin/:id/claim", requireJwt(), claimPrize);

export default router;

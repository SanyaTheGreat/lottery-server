import { Router } from "express";
import { spinCase, claimPrize, rerollPrize } from "../controllers/case/caseSpinController.js";

const router = Router();

// 🎰 Запуск спина
router.post("/case/spin", spinCase);

// 🏆 Получить приз
router.post("/case/spin/:id/claim", claimPrize);

// 🔄 Продать приз (reroll)
router.post("/case/spin/:id/reroll", rerollPrize);

export default router;

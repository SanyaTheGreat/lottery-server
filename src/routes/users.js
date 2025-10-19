import express from 'express';
import {
  register as addUser,
  updateWallet,
  buyTickets,
  getProfile,
  getReferrals,
  createSell,
  getTicketPurchases,
  withdrawReferral,
  getLeaderboard,
  getLeaderboardReferrals
} from '../controllers/users/index.js';

import { authenticateJWT } from '../middleware/authenticateJWT.js';

// опционально: миддлвара, которая ПЫТАЕТСЯ прочитать JWT, но не 401, если его нет
// если её нет, можно убрать и оставить лидеры без миддлвары — просто me будет null
import { authenticateJWTOptional } from '../middleware/authenticateJWTOptional.js';

const router = express.Router();

// 🔐 Личная зона (только по JWT)
router.post('/register', authenticateJWT, addUser);         // апсерт пользователя по токену
router.patch('/wallet', authenticateJWT, updateWallet);     // { wallet }
router.get('/profile', authenticateJWT, getProfile);        // без :telegram_id
router.get('/referrals', authenticateJWT, getReferrals);    // без :telegram_id
router.get('/sells', authenticateJWT, getTicketPurchases);  // без :telegram_id
router.post('/withdraw', authenticateJWT, withdrawReferral);
router.post('/sell', authenticateJWT, createSell);
router.post('/buy-tickets', authenticateJWT, buyTickets);

// 🏆 Лидерборды (публичные + опциональный JWT для поля "me")
router.get('/leaderboard', authenticateJWTOptional, getLeaderboard);
router.get('/leaderboard-referrals', authenticateJWTOptional, getLeaderboardReferrals);

export default router;

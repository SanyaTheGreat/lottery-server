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

import { requireJwt, optionalJwt } from '../middleware/requireJwt.js';

const router = express.Router();

// 🔐 Личная зона (только по JWT)
router.post('/register', requireJwt(), addUser);
router.patch('/wallet', requireJwt(), updateWallet);
router.get('/profile', requireJwt(), getProfile);
router.get('/referrals', requireJwt(), getReferrals);
router.get('/sells', requireJwt(), getTicketPurchases);
router.post('/withdraw', requireJwt(), withdrawReferral);
router.post('/sell', requireJwt(), createSell);
router.post('/buy-tickets', requireJwt(), buyTickets);

// 🏆 Лидерборды (публичные, но "me" заполним, если передан токен)
router.get('/leaderboard', optionalJwt(), getLeaderboard);
router.get('/leaderboard-referrals', optionalJwt(), getLeaderboardReferrals);

export default router;

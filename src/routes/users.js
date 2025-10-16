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
// import { getAllUsers } from '../controllers/usersController.js'; // опционально

const router = express.Router();

router.get('/sells/:telegram_id', getTicketPurchases)
router.post('/register', addUser);
router.post('/sell', createSell);
router.patch('/wallet', updateWallet);
router.post('/buy-tickets', buyTickets);
router.get('/profile/:telegram_id', getProfile);
router.get('/referrals/:telegram_id', getReferrals);
router.post('/withdraw', withdrawReferral);
router.get('/leaderboard', getLeaderboard);
router.get('/leaderboard-referrals', getLeaderboardReferrals);



// router.get('/', getAllUsers); // если всё перенесено в getProfile — это можно убрать

export default router;

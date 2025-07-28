import express from 'express';
import {
  createWheel,
  joinWheel,
  getWheelParticipants,
  getParticipations,
  getAllResults,
  getActiveWheels,
  getCompletedWheels,
  drawWinner,
  deleteWheel,
  logNftTransfer,
  getPendingRewards,
  claimReward,
  getWheelById,
  getAvailableGifts
} from '../controllers/wheel/index.js';


import { getUserWins } from '../controllers/wheel/getUserWins.js';

const router = express.Router();

router.get('/results', getAllResults);
router.get('/active', getActiveWheels);
router.get('/completed', getCompletedWheels);

router.get('/wheel/gifts/availablegifts', getAvailableGifts);
router.get('/:wheel_id/participants', getWheelParticipants);
router.get('/:wheel_id', getWheelById);
router.post('/create', createWheel);
router.post('/join', joinWheel);
router.post('/:wheel_id/draw', drawWinner);
router.get('/:telegram_id/wins', getUserWins);
router.get('/:telegram_id/participations', getParticipations);
router.delete('/:wheel_id', deleteWheel);
router.post('/nft-transfer', logNftTransfer);
router.get('/pending-rewards', getPendingRewards);
router.post('/claim', claimReward);



export default router;

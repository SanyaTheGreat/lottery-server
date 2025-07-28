import express from 'express';
import { getAvailableGifts } from '../controllers/gifts/getAvailableGifts.js';

const router = express.Router();

router.get('/available-gifts', getAvailableGifts);

export default router;

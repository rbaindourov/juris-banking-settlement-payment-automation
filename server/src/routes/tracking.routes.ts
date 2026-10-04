import { Router } from 'express';
import { TrackingController } from '../controllers/tracking.controller';
import { trackingPixelRateLimiter, trackingClickRateLimiter } from '../middleware/rateLimiter';

const router = Router();

router.get('/pixel/:token', trackingPixelRateLimiter, TrackingController.handlePixel);
router.get('/click/:token', trackingClickRateLimiter, TrackingController.handleClick);

export default router;

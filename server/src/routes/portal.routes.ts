import { Router } from 'express';
import { PortalController } from '../controllers/portal.controller';
import { portalRateLimiter } from '../middleware/rateLimiter';

const router = Router();

router.get('/:token', portalRateLimiter, PortalController.getClaim);
router.post('/:token/select-payment', portalRateLimiter, PortalController.selectPayment);
router.get('/:token/receipt', portalRateLimiter, PortalController.getReceipt);

export default router;

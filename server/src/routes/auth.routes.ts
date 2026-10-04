import { Router } from 'express';
import {
  register,
  login,
  logout,
  getCurrentUser,
  refreshToken,
  registerSchema,
  loginSchema,
  refreshSchema
} from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';
import { authRateLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/register', validateRequest({ body: registerSchema }), authRateLimiter, register);
router.post('/login', validateRequest({ body: loginSchema }), authRateLimiter, login);
router.post('/refresh', validateRequest({ body: refreshSchema }), refreshToken);
router.post('/logout', logout);
router.get('/me', authenticateToken, getCurrentUser);

export default router;

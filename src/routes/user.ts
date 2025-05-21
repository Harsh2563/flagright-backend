import { RequestHandler, Router } from 'express';
import { validateRequest } from '../middleware/validateRequest';
import { UserSchema } from '../validators/user';
import UserController from '../controllers/user';

const router = Router();

router.post(
  '/',
  validateRequest(UserSchema),
  UserController.handleUser as RequestHandler
);
router.get('/', UserController.getAllUsers as RequestHandler);

export default router;

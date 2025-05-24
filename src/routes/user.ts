import { RequestHandler, Router } from 'express';
import { validateRequest } from '../middleware/validateRequest';
import { validateSearchQuery } from '../middleware/validateSearchQuery';
import { UserSchema } from '../validators/user';
import { UserSearchSchema } from '../validators/userSearch';
import UserController from '../controllers/user';

const router = Router();

router.post(
  '/',
  validateRequest(UserSchema),
  UserController.handleUser as RequestHandler
);

router.get('/', UserController.getAllUsers as RequestHandler);

router.get(
  '/search',
  validateSearchQuery(UserSearchSchema),
  UserController.searchUsers as RequestHandler
);

export default router;

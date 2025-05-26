import { RequestHandler, Router } from 'express';
import { validateRequest } from '../middleware/validateRequest';
import { validateSearchQuery } from '../middleware/validateSearchQuery';
import { ShortestPath, UserSchema } from '../validators/user';
import { UserSearchSchema } from '../validators/user';
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

router.post(
  '/shortest-path',
  validateRequest(ShortestPath),
  UserController.getShortestPath as RequestHandler
);
export default router;

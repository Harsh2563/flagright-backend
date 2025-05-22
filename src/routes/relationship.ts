import { RequestHandler, Router } from 'express';
import RelationshipController from '../controllers/relationships';

const router = Router();

router.get(
  '/user/:userId',
  RelationshipController.getUserRelationships as RequestHandler
);

router.get(
  '/transaction/:transactionId',
  RelationshipController.getTransactionRelationships as RequestHandler
);

export default router;

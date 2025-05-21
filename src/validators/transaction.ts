import { z } from 'zod';
import { PaymentMethodType, TransactionStatus, TransactionType } from '../types/enums/TransactionEnums';

const GeolocationSchema = z.object({
  country: z.string().optional(),
  city: z.string().optional()
});

const DeviceInfoSchema = z.object({
  ipAddress: z.string().ip().optional(),
  geolocation: GeolocationSchema.optional()
});

export const TransactionSchema = z.object({
  id: z.string().uuid('Invalid transaction ID format').optional(),
  transactionType: z.nativeEnum(TransactionType, {
    errorMap: () => ({ message: 'Invalid transaction type' })
  }),
  status: z.nativeEnum(TransactionStatus, {
    errorMap: () => ({ message: 'Invalid transaction status' })
  }),
  senderId: z.string().uuid('Invalid sender ID format'),
  receiverId: z.string().uuid('Invalid receiver ID format'),
  amount: z.number().positive('Amount must be a positive number'),
  currency: z.string().min(1, 'Currency is required'),
  destinationAmount: z.number().positive('Destination amount must be a positive number').optional(),
  destinationCurrency: z.string().optional(),
  timestamp: z.string().datetime({ offset: true }).optional().default(() => new Date().toISOString()),
  description: z.string().optional(),
  deviceId: z.string().optional(),
  deviceInfo: DeviceInfoSchema.optional(),
  paymentMethod: z.nativeEnum(PaymentMethodType).optional(),
});


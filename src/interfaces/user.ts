import { PaymentMethodType } from "../types/enums/UserEnums";

export interface IUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  password?: string;
  emailVerified: boolean;
  googleId?: string;
  googleProfile?: {
    displayName?: string;
    email?: string;
    picture?: string;
  };
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  paymentMethods?: Array<{
    id: string;
    type: PaymentMethodType;
  }>;
  createdAt: string;
  updatedAt: string;
}

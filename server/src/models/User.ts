import mongoose, { Schema, Document, Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import { UserRole, USER_ROLES } from '../types';
import { config } from '../config/env';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  role: UserRole;
  lawFirmId?: string | null;
  fullName: string;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

export interface IUserModel extends Model<IUser> {
  hashPassword(password: string, saltRounds?: number): Promise<string>;
}

const UserSchema = new Schema<IUser, IUserModel>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required']
    },
    role: {
      type: String,
      required: [true, 'Role is required'],
      enum: {
        values: USER_ROLES,
        message: 'Invalid user role: {VALUE}'
      },
      default: 'case_manager',
      index: true
    },
    lawFirmId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        delete ret._id;
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      }
    }
  }
);

UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

UserSchema.statics.hashPassword = async function (password: string, saltRounds?: number): Promise<string> {
  const rounds = saltRounds ?? config.SALT_ROUNDS;
  return bcrypt.hash(password, rounds);
};

export const User = (mongoose.models.User as IUserModel) || mongoose.model<IUser, IUserModel>('User', UserSchema);

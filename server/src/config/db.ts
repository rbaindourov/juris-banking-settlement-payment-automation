import mongoose from 'mongoose';
import { config } from './env';

export async function connectDb(uri?: string): Promise<typeof mongoose> {
  const targetUri = uri || (config.NODE_ENV === 'test' ? config.MONGODB_URI_TEST : config.MONGODB_URI);
  
  if (mongoose.connection.readyState === 1) {
    const targetDbName = targetUri.split('/').pop()?.split('?')[0];
    if (mongoose.connection.db?.databaseName === targetDbName) {
      return mongoose;
    }
    await disconnectDb();
  }

  try {
    const conn = await mongoose.connect(targetUri, {
      autoIndex: true
    });
    return conn;
  } catch (error) {
    console.error(`[MongoDB] Connection error to ${targetUri}:`, error);
    throw error;
  }
}

export async function disconnectDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

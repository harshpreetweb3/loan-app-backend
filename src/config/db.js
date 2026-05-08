import mongoose from 'mongoose';

let connectionPromise;

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectionPromise) return connectionPromise;

  mongoose.set('strictQuery', true);
  connectionPromise = mongoose.connect(uri).then((connection) => {
    console.log('MongoDB connected');
    return connection;
  });
  return connectionPromise;
}

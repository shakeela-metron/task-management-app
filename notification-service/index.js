const amqp = require('amqplib');
const mongoose = require('mongoose');

mongoose.connect('mongodb://mongodb:27017/notification-service').then(() => {
    console.log('Connected to MongoDB');
}).catch(err => console.error('Could not connect to MongoDB', err));

const notificationSchema = new mongoose.Schema({
    message: String,
    taskId: String,
    status: {type: String, enum: ['pending', 'sent', 'failed'], default: 'pending'},
    receivedAt: { type: Date, default: Date.now }
});

const Notification = mongoose.model('Notification', notificationSchema);

async function connectRabbitMQWithRetry() {
    const rabbitUrl = process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672';
    
    try {
        const connection = await amqp.connect(rabbitUrl);
        const channel = await connection.createChannel();
        await channel.assertQueue('task_created');
        
        console.log('Notification Service is listening to RabbitMQ');

        channel.consume('task_created', async (msg) => {
            if (msg !== null) {
                const task = JSON.parse(msg.content.toString());
                const notification = new Notification({
                    message: `New task created: ${task.title}`,
                    taskId: task._id
                });
                await notification.save();
                console.log('Notification persisted to DB');
                console.log('Task received and processed:', task);
                channel.ack(msg);
            }
        });

        // Handle connection closure
        connection.on('close', () => {
            console.error('RabbitMQ connection closed. Retrying...');
            setTimeout(connectRabbitMQWithRetry, 5000);
        });

    } catch (error) {
        console.error('RabbitMQ connection failed. Retrying in 5 seconds...', error.message);
        setTimeout(connectRabbitMQWithRetry, 5000); // Keep trying every 5 seconds
    }
}

connectRabbitMQWithRetry().catch(err => {
    console.error('Failed to connect to RabbitMQ:', err);
    process.exit(1);
});
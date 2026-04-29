const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const amqp = require('amqplib');
const { URL } = require('url');

const app = express();
const port = 3002;
app.use(bodyParser.json());

mongoose.connect('mongodb://mongodb:27017/task-service').then(() => {
    console.log('Connected to MongoDB');
}).catch(err => console.error('Could not connect to MongoDB', err));

const taskSchema = new mongoose.Schema({
    title: String,
    description: String,
    userId: String,
    done: Boolean
});
const Task = mongoose.model('Task', taskSchema);
let channel;

async function connectRabbitMQWithRetry(retryCount = 5, retryDelay = 3000) {
    while (retryCount > 0) {
        try {
            const connection = await amqp.connect('amqp://rabbitmq:5672');
            channel = await connection.createChannel();
            await channel.assertQueue('task_created');
            console.log('RabbitMQ connection established');
            return;
        } catch (error) {
            console.error('Error connecting to RabbitMQ:', error.message);
            retryCount--;
            console.log(`Retrying in ${retryDelay} ms... (${retryCount} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
}

app.post('/tasks', (req, res) => {
    const { title, description, userId, done } = req.body;
    console.log('Received task creation request:', req.body);

    const missingFields = [];
    if (!title) missingFields.push('title');
    if (!description) missingFields.push('description');
    if (!userId) missingFields.push('userId');
    if (done === undefined) missingFields.push('done');
    if (missingFields.length > 0) {
        return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });
    }
    const validTypes = [
        { field: 'title', type: 'string' },
        { field: 'description', type: 'string' },
        { field: 'userId', type: 'string' },
        { field: 'done', type: 'boolean' }
    ];
    const invalidTypes = validTypes.filter(vt => typeof req.body[vt.field] !== vt.type);
    if (invalidTypes.length > 0) {
        return res.status(400).json({ error: `Invalid field types: ${invalidTypes.map(it => `${it.field} should be ${it.type}`).join(', ')}` });
    }
    const userServiceUrl = new URL('http://user-service:3001/users/' + userId);
    fetch(userServiceUrl).then(response => {
        if (!response.ok) {
            return res.status(404).json({ error: 'User not found' });
        }
        const task = new Task({ title, description, userId, done });
        task.save().then(savedTask => {
            console.log('Task created successfully:');
            if (!channel) {
                console.error('RabbitMQ channel is not available. Task creation event will not be published.');
            } else {
                channel.sendToQueue('task_created', Buffer.from(JSON.stringify(savedTask)));
                console.log('Published task creation event to RabbitMQ:', savedTask);
            }
            res.status(201).json(savedTask);
        }).catch(err => {
            res.status(400).json({ error: err.message });
        });
    }).catch(err => {
        res.status(500).json({ error: err.message });
    });
});

app.get('/tasks', (req, res) => {
    console.log('Received request to get all tasks');
    Task.find().then(tasks => {
        res.json(tasks);
    });
});

app.get('/tasks/:id', (req, res) => {
    console.log('Received request to get task by ID:', req.params.id);
    const taskId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
        return res.status(400).json({ error: 'Invalid task ID format' });
    }
    Task.findById(taskId).then(task => {
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }
        res.json(task);
    });
});

app.put('/tasks/:id', (req, res) => {
    console.log('Received request to update task:', req.params.id);
    const taskId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
        return res.status(400).json({ error: 'Invalid task ID format' });
    }
    Task.findByIdAndUpdate(taskId, req.body, { new: true }).then(task => {
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }
        res.json(task);
    });
});

app.delete('/tasks/:id', (req, res) => {
    console.log('Received request to delete task:', req.params.id);
    const taskId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
        return res.status(400).json({ error: 'Invalid task ID format' });
    }
    Task.findByIdAndDelete(taskId).then(task => {
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }
        res.json({ message: 'Task deleted successfully' });
    });
});

app.use((req, res, next) => {
    res.status(404).json({ error: 'Endpoint not found in task-service' });
});

app.use((err, req, res, next) => {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal Server Error in task-service' });
});



app.listen(port, () => {
    console.log(`Task service running on port ${port}`);
    connectRabbitMQWithRetry();
});

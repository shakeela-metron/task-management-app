const express = require('express')
const mongoose = require('mongoose')
const bodyParser = require('body-parser')


const app = express()
const port = 3001
app.use(bodyParser.json())

mongoose.connect('mongodb://mongodb:27017/user-service'
).then(() => {
    console.log('Connected to MongoDB')
}).catch(err => console.error('Could not connect to MongoDB', err));


const userSchema = new mongoose.Schema({
    name: String,
    email: String,
    password: String
});
const User = mongoose.model('User', userSchema);

app.post('/users', (req, res) => {
    console.log('Received user creation request:', req.body);
    const { name, email, password } = req.body;
    const missingFields = [];
    if (!name) missingFields.push('name');
    if (!email) missingFields.push('email');
    if (!password) missingFields.push('password');
    if (missingFields.length > 0) {
        return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });
    }
    const validTypes = [
        { field: 'name', type: 'string' },
        { field: 'email', type: 'string' },
        { field: 'password', type: 'string' }
    ];
    const invalidTypes = validTypes.filter(vt => typeof req.body[vt.field] !== vt.type);
    if (invalidTypes.length > 0) {
        return res.status(400).json({ error: `Invalid field types: ${invalidTypes.map(it => `${it.field} should be ${it.type}`).join(', ')}` });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
    if (!passwordRegex.test(password)) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long and contain both letters and numbers' });
    }
    const existingUser = User.findOne({ email }).then(userDetails => {
        if (userDetails) {
            return res.status(400).json({ error: 'Email already in use', existingUser: { id: userDetails._id, name: userDetails.name, email: userDetails.email } });
        }
        const user = new User({ name, email, password });
        user.save().then(() => {
            res.status(201).json(user);
        });
    });
});

app.get('/users', (req, res) => {
    console.log('Received request to get all users');
    User.find().then(users => {
        res.send(users);
    }).catch(err => {
        res.status(500).send(err);
    });
})

app.get('/users/:id', (req, res) => {
    console.log('Received request to get user with id:', req.params.id);
    const userId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
    }
    const user = User.findById(userId).then(user => {
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.send(user);
    }).catch(err => {
        res.status(500).send(err);
    });
})

app.put('/users/:id', (req, res) => {
    console.log('Received request to update user with id:', req.params.id);
    const userId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
    }
    User.findByIdAndUpdate(userId, req.body, { new: true }).then(user => {
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.send(user);
    }).catch(err => {
        res.status(500).send(err);
    });
});

app.delete('/users/:id', (req, res) => {
    console.log('Received request to delete user with id:', req.params.id);
    const userId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
    }
    User.findByIdAndDelete(userId).then(user => {
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.send(user);
    }).catch(err => {
        res.status(500).send(err);
    });
});


app.use((req, res, next) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})

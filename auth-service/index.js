const express = require('express')
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const amqp = require('amqplib')
const bodyParser = require('body-parser')
const jsonwebtoken = require('jsonwebtoken')
const { createProxyMiddleware } = require('http-proxy-middleware')


const app = express()
const port = 3000
const JWT_SECRET = 'your_jwt_secret_key'; // In production, use a secure method to store this secret
const MONGO_URL = 'mongodb://mongodb:27017/auth-service'; // MongoDB connection string for auth-service
app.use(bodyParser.json()); // Middleware to parse JSON bodies

let rabbitmqChannel;
async function connectRabbitMQWithRetry(retryCount = 5, retryDelay = 3000) {
    while (retryCount > 0) {
        try {
            const connection = await amqp.connect('amqp://rabbitmq:5672');
            rabbitmqChannel = await connection.createChannel();
            await rabbitmqChannel.assertQueue('user_registered');
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

// Connect to MongoDB
mongoose.connect(MONGO_URL).then(() => {
    console.log('Auth service connected to MongoDB');
}).catch(err => console.error('Could not connect to MongoDB', err));

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const User = mongoose.model('User', userSchema); // User model for authentication

// Authentication endpoints
// For demonstration purposes, we are implementing simple registration and login endpoints. In a real application, you would likely want to implement more robust authentication and authorization logic, including role-based access control (RBAC) and proper error handling for authentication failures.
// The registration endpoint allows users to create an account by providing their name, email, and password. The password is hashed using bcrypt before being stored in the database for security reasons. The login endpoint allows users to authenticate by providing their email and password. If the credentials are valid, a JWT token is generated and returned to the client for use in subsequent authenticated requests.
// Note: In a real application, you would likely want to implement additional features such as email verification, password reset functionality, and more robust error handling for authentication failures. This is a simplified example for demonstration purposes.
app.post('/auth/register', (req, res) => {
    const { name, email, password } = req.body;
    console.log('Received registration request:', req.body);
    const missingFields = [];
    if (!name) missingFields.push('name');
    if (!email) missingFields.push('email');
    if (!password) missingFields.push('password');
    if (missingFields.length > 0) {
        return res.status(400).json({ error: `Missing fields: ${missingFields.join(', ')}` });
    }

    // Hash the password using bcrypt before saving it to the database. This is a common practice to enhance security by ensuring that plaintext passwords are not stored in the database. The bcrypt.hash function takes the plaintext password and a salt rounds parameter (in this case, 10) and returns a promise that resolves to the hashed password. Once the password is hashed, we can save the user to the database with the hashed password.
    // Note: In a real application, you would likely want to implement additional security measures such as password strength validation and rate limiting for registration attempts to prevent abuse. This is a simplified example for demonstration purposes.
    bcrypt.hash(password, 10).then(hashedPassword => {
        // Save user to database (simplified for this example)
        const user = new User({ name, email, password: hashedPassword });
        user.save().then(() => {
            // Publish user registered event to RabbitMQ
            if (rabbitmqChannel) {
                rabbitmqChannel.sendToQueue('user_registered', Buffer.from(JSON.stringify({ userId: user._id, email: user.email, name: user.name, password: hashedPassword })));
            }
            res.status(201).json({ message: 'User registered successfully' });
        }).catch(err => {
            console.error('Error saving user:', err);
            res.status(500).json({ error: 'Error registering user' });
        });
    });
});

// The login endpoint allows users to authenticate by providing their email and password. If the credentials are valid, a JWT token is generated and returned to the client for use in subsequent authenticated requests. The token is signed with a secret key and has an expiration time of 1 hour. The client can use this token in the Authorization header for subsequent requests to access protected resources.
// Note: In a real application, you would likely want to implement additional features such as email verification, password reset functionality, and more robust error handling for authentication failures. This is a simplified example for demonstration purposes.
// Additionally, you might want to implement role-based access control (RBAC) or other authorization mechanisms to ensure that users can only access the resources they are authorized to access. This is a simplified example for demonstration purposes.
app.post('/auth/login', (req, res) => {
    const { email, password } = req.body;
    console.log('Received login request:', req.body);

    // Find the user by email
    User.findOne({ email }).then(user => {
        if (!user) {
            // If the user is not found, return an error response. This is a common practice to prevent user enumeration attacks, where an attacker can determine if a user exists based on the error message returned by the login endpoint. By returning a generic error message for both cases (user not found and incorrect password), we can help protect against this type of attack.
            // Note: In a real application, you would likely want to implement additional security measures such as rate limiting and account lockout after multiple failed login attempts to prevent brute-force attacks. This is a simplified example for demonstration purposes.
            // Additionally, you might want to implement multi-factor authentication (MFA) for added security, especially for sensitive operations or accounts with elevated privileges. This is a simplified example for demonstration purposes.
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Verify the password using bcrypt. The bcrypt.compare function takes the plaintext password provided by the user and the hashed password stored in the database, and returns a boolean indicating whether they match. If the passwords do not match, an error response is returned. If they match, a JWT token is generated and returned to the client for use in subsequent authenticated requests.
        // Note: In a real application, you would likely want to implement additional security measures such as rate limiting and account lockout after multiple failed login attempts to prevent brute-force attacks. This is a simplified example for demonstration purposes.
        // Additionally, you might want to implement multi-factor authentication (MFA) for added security, especially for sensitive operations or accounts with elevated privileges. This is a simplified example for demonstration purposes.
        // In a real application, you would also want to implement proper error handling and logging for authentication failures to help with debugging and monitoring of your application. This is a simplified example for demonstration purposes.
        bcrypt.compare(password, user.password).then(isMatch => {
            if (!isMatch) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            // Generate a JWT token
            // The JWT token is generated using the jsonwebtoken library. The payload of the token includes the user's email, and it is signed with a secret key (JWT_SECRET). The token has an expiration time of 1 hour. The client can use this token in the Authorization header for subsequent requests to access protected resources.
            // Note: In a real application, you would likely want to include additional information in the token payload (e.g., user ID, roles) and implement proper error handling for token generation failures. This is a simplified example for demonstration purposes.            const token = jsonwebtoken.sign({ email: user.email }, JWT_SECRET, { expiresIn: '1h' });
            res.status(200).json({ message: 'Login successful', token });
        });
    }).catch(err => {
        // In a real application, you would want to implement proper error handling and logging for authentication failures to help with debugging and monitoring of your application. This is a simplified example for demonstration purposes.
        console.error('Error during login:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    });
});


// Authentication middleware (for demonstration purposes, this is a simple implementation)
// In a real application, you would likely want to implement more robust authentication and authorization logic, including role-based access control (RBAC) and proper error handling for authentication failures.
// This middleware checks for the presence of a JWT token in the Authorization header and verifies it. If the token is valid, it allows the request to proceed; otherwise, it returns an appropriate error response.
// Note: In a real application, you would likely want to have more granular control over which endpoints require authentication and what kind of authentication is required. This is a simplified example for demonstration purposes.
// Additionally, you might want to implement role-based access control (RBAC) or other authorization mechanisms to ensure that users can only access the resources they are authorized to access.
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    // Verify the token
    // The jsonwebtoken.verify function takes the token, the secret key, and a callback function. If the token is valid, the decoded payload is passed to the callback function as the 'user' parameter. If the token is invalid (e.g., expired, malformed), an error is passed to the callback function. In this case, we return a 403 Forbidden response with an appropriate error message. If the token is valid, we attach the decoded user information to the request object (req.user) and call next() to proceed to the next middleware or route handler.
    // Note: In a real application, you would likely want to implement additional security measures such as token revocation and refresh tokens to enhance the security of your authentication system. This is a simplified example for demonstration purposes.
    jsonwebtoken.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
}

// Proxy setup for user-service
// For demonstration purposes, we are applying the same authentication middleware to both user-service and task-service. In a real application, you would likely want to have different authentication/authorization logic for different services based on the specific requirements of each service.
// Note: In a real application, you would likely want to have more granular control over which endpoints require authentication and what kind of authentication is required. This is a simplified example for demonstration purposes.
// Additionally, you might want to implement role-based access control (RBAC) or other authorization mechanisms to ensure that users can only access the resources they are authorized to access.
// For example, you might want to allow unauthenticated access to certain endpoints (e.g., public information) while requiring authentication for others (e.g., user profile, task management). You could also implement different levels of access based on user roles (e.g., admin, regular user) to further control access to resources.
// In this example, we are applying the same authentication middleware to both user-service and task-service for simplicity. In a real application, you would likely want to have different authentication/authorization logic for different services based on the specific requirements of each service.
// For example, you might want to allow unauthenticated access to certain endpoints in user-service (e.g., public user profiles) while requiring authentication for others (e.g., user management). Similarly, you might want to allow unauthenticated access to certain endpoints in task-service (e.g., public task listings) while requiring authentication for others (e.g., task management).
// In a real application, you would also want to implement proper error handling and logging for authentication and authorization failures to help with debugging and monitoring of your application.
app.use('/users', authenticateToken, createProxyMiddleware({
    target: 'http://user-service:3001',
    changeOrigin: true,
    pathRewrite: { '^/users': '/users' }
}));

// Proxy setup for task-service
// For demonstration, we are applying the same authentication middleware to task-service. In a real application, you might want to have different authentication/authorization logic for different services.
app.use('/tasks', authenticateToken, createProxyMiddleware({
    target: 'http://task-service:3002',
    changeOrigin: true,
    // Note: The pathRewrite option is used to rewrite the URL path before forwarding the request to the target service. In this case, we are rewriting '/tasks' to '/tasks', which effectively means that the path remains unchanged. This is a common practice when setting up a proxy to ensure that the target service receives the expected URL path.
    // In a real application, you might want to have different path rewrites for different services based on the specific requirements of each service. For example, you might want to rewrite '/users' to '/api/users' for user-service and '/tasks' to '/api/tasks' for task-service to maintain a consistent API structure across your services.
    // Additionally, you might want to implement more complex path rewrites based on the specific needs of your application. For example, you could rewrite '/users/:id' to '/api/users/:id' to maintain a consistent API structure while allowing for dynamic path parameters.
    pathRewrite: { '^/tasks': '/tasks' }
}));

app.use((req, res, next) => {
    res.status(404).json({ error: 'Endpoint not found in auth-service' });
});

app.use((err, req, res, next) => {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal Server Error in auth-service' });
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
    connectRabbitMQWithRetry();
})

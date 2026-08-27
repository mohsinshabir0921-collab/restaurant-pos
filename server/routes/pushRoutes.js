const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { 
  subscribePush, 
  unsubscribePush, 
  getVapidPublicKey 
} = require('../controllers/pushController');

// All routes require authentication
router.use(protect);

router.get('/vapid-key', getVapidPublicKey);
router.post('/subscribe', subscribePush);
router.post('/unsubscribe', unsubscribePush);

module.exports = router;

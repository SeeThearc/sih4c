# Enhanced version of your chainlink_ml_server.py
"""
Enhanced ML API Server for Chainlink Oracle Integration
"""
from flask import Flask, request, jsonify
import tensorflow as tf
import cv2
import numpy as np
from PIL import Image
import io
import time
import logging
import requests
from urllib.parse import urlparse

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)

class ChainlinkMLAPI:
    def __init__(self):
        try:
            self.model = tf.keras.models.load_model('quick_model_FINAL.h5')
            self.classes = ['fresh', 'rotten']
            self.input_size = (128, 128)
            self.request_count = 0  # Track requests for monitoring
            print("✅ ML Model loaded for Chainlink integration!")
        except Exception as e:
            print(f"❌ Error loading model: {e}")
            raise
    
    def preprocess_image_from_url(self, image_url):
        """Enhanced image preprocessing with better error handling"""
        try:
            # Validate URL
            parsed_url = urlparse(image_url)
            if not parsed_url.scheme or not parsed_url.netloc:
                raise ValueError("Invalid URL format")
            
            # Download with better headers
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            response = requests.get(image_url, timeout=15, headers=headers)
            response.raise_for_status()
            
            # Check content type
            content_type = response.headers.get('content-type', '')
            if not content_type.startswith('image/'):
                raise ValueError(f"URL does not point to an image. Content-Type: {content_type}")
            
            # Convert to PIL Image
            image = Image.open(io.BytesIO(response.content))
            image = image.convert('RGB')
            
            # Convert to numpy and preprocess
            image = np.array(image)
            image = cv2.resize(image, self.input_size)
            image = image.astype('float32') / 255.0
            image = np.expand_dims(image, axis=0)
            
            return image
            
        except requests.exceptions.RequestException as e:
            raise Exception(f"Failed to download image: {str(e)}")
        except Exception as e:
            raise Exception(f"Failed to process image: {str(e)}")
    
    def predict_damage(self, image_url):
        """Enhanced prediction with better error handling"""
        try:
            self.request_count += 1
            
            # Preprocess image
            processed_image = self.preprocess_image_from_url(image_url)
            
            # Make prediction
            predictions = self.model.predict(processed_image, verbose=0)
            
            # Get results
            fresh_prob = float(predictions[0][0])
            rotten_prob = float(predictions[0][1])
            
            # Determine result
            if fresh_prob > rotten_prob:
                prediction = "fresh"
                confidence = fresh_prob
                damage_score = int((1 - fresh_prob) * 100)
            else:
                prediction = "rotten"
                confidence = rotten_prob
                damage_score = int(rotten_prob * 100)
            
            # Ensure damage_score is within bounds
            damage_score = max(0, min(100, damage_score))
            
            return {
                'prediction': prediction,
                'damage_score': damage_score,
                'confidence': round(confidence * 100, 2),
                'fresh_probability': round(fresh_prob * 100, 2),
                'rotten_probability': round(rotten_prob * 100, 2),
                'timestamp': int(time.time()),
                'model_version': 'v1.0',
                'request_id': self.request_count
            }
            
        except Exception as e:
            raise Exception(f"Prediction failed: {str(e)}")

# Initialize ML model
ml_api = ChainlinkMLAPI()

@app.route('/predict', methods=['POST', 'GET'])
def chainlink_predict():
    """Enhanced prediction endpoint with better logging"""
    try:
        # Get image URL
        if request.method == 'GET':
            image_url = request.args.get('image_url')
        else:
            data = request.get_json()
            image_url = data.get('image_url') if data else None
        
        if not image_url:
            return jsonify({
                'error': 'image_url parameter required',
                'damage_score': -1
            }), 400
        
        # Log request with more details
        app.logger.info(f"🔗 Chainlink prediction request #{ml_api.request_count + 1}")
        app.logger.info(f"📷 Image URL: {image_url[:100]}...")
        
        # Make prediction
        result = ml_api.predict_damage(image_url)
        
        # Chainlink-optimized response
        chainlink_response = {
            'damage_score': result['damage_score'],
            'prediction': result['prediction'],
            'confidence': int(result['confidence']),  # Integer for gas efficiency
            'timestamp': result['timestamp'],
            'model_version': result['model_version']
        }
        
        app.logger.info(f"✅ Prediction: {result['prediction']} (damage: {result['damage_score']}/100)")
        return jsonify(chainlink_response)
        
    except Exception as e:
        app.logger.error(f"❌ Prediction error: {str(e)}")
        return jsonify({
            'error': str(e),
            'damage_score': -1,
            'timestamp': int(time.time())
        }), 500

@app.route('/health', methods=['GET'])
def health():
    """Enhanced health check"""
    return jsonify({
        'status': 'healthy',
        'model_loaded': True,
        'total_requests': ml_api.request_count,
        'model_version': 'v1.0',
        'chainlink_compatible': True,
        'timestamp': int(time.time())
    })

@app.route('/stats', methods=['GET'])
def stats():
    """API statistics endpoint"""
    return jsonify({
        'total_predictions': ml_api.request_count,
        'model_info': {
            'classes': ml_api.classes,
            'input_size': ml_api.input_size,
            'version': 'v1.0'
        },
        'server_uptime': int(time.time()),
        'endpoints': ['/predict', '/health', '/stats']
    })

if __name__ == '__main__':
    print("🔗 Starting Enhanced Chainlink ML API Server...")
    print("📡 Endpoints:")
    print("   GET /predict?image_url=<url> - Damage prediction")
    print("   GET /health - Health check")
    print("   GET /stats - Server statistics")
    
    # For production, use gunicorn or similar
    app.run(host='127.0.0.1', port=5000, debug=False)
"""
ML API Server for Chainlink Oracle Integration
Deploy this on a VPS/cloud server with public endpoint
"""
from flask import Flask, request, jsonify
import tensorflow as tf
import cv2
import numpy as np
import base64
from PIL import Image
import io
import time
import logging

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)

class ChainlinkMLAPI:
    def __init__(self):
        # Load your trained model
        try:
            self.model = tf.keras.models.load_model('quick_model_FINAL.h5')
            self.classes = ['fresh', 'rotten']
            self.input_size = (128, 128)
            print("✅ ML Model loaded for Chainlink integration!")
        except Exception as e:
            print(f"❌ Error loading model: {e}")
            raise
    
    def preprocess_image_from_url(self, image_url):
        """Download and preprocess image from URL"""
        import requests
        
        try:
            # Download image
            response = requests.get(image_url, timeout=10)
            response.raise_for_status()
            
            # Convert to PIL Image
            image = Image.open(io.BytesIO(response.content))
            image = image.convert('RGB')
            
            # Convert to numpy and preprocess
            image = np.array(image)
            image = cv2.resize(image, self.input_size)
            image = image.astype('float32') / 255.0
            image = np.expand_dims(image, axis=0)
            
            return image
            
        except Exception as e:
            raise Exception(f"Failed to process image from URL: {str(e)}")
    
    def predict_damage(self, image_url):
        """Make damage prediction for Chainlink"""
        try:
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
                damage_score = int((1 - fresh_prob) * 100)  # Lower score = less damage
            else:
                prediction = "rotten"
                confidence = rotten_prob
                damage_score = int(rotten_prob * 100)  # Higher score = more damage
            
            return {
                'prediction': prediction,
                'damage_score': damage_score,  # 0-100 scale for smart contract
                'confidence': round(confidence * 100, 2),
                'fresh_probability': round(fresh_prob * 100, 2),
                'rotten_probability': round(rotten_prob * 100, 2),
                'timestamp': int(time.time()),
                'model_version': 'v1.0'
            }
            
        except Exception as e:
            raise Exception(f"Prediction failed: {str(e)}")

# Initialize ML model
ml_api = ChainlinkMLAPI()

@app.route('/predict', methods=['POST', 'GET'])
def chainlink_predict():
    """
    Chainlink-compatible prediction endpoint
    Expected: GET /predict?image_url=https://example.com/image.jpg
    Returns: JSON with damage_score (0-100)
    """
    try:
        # Get image URL from query params (Chainlink style)
        if request.method == 'GET':
            image_url = request.args.get('image_url')
        else:  # POST
            data = request.get_json()
            image_url = data.get('image_url') if data else None
        
        if not image_url:
            return jsonify({
                'error': 'image_url parameter required'
            }), 400
        
        # Log request
        app.logger.info(f"Prediction request for: {image_url}")
        
        # Make prediction
        result = ml_api.predict_damage(image_url)
        
        # Chainlink expects simple response
        chainlink_response = {
            'damage_score': result['damage_score'],
            'prediction': result['prediction'],
            'confidence': result['confidence']
        }
        
        app.logger.info(f"Prediction result: {chainlink_response}")
        return jsonify(chainlink_response)
        
    except Exception as e:
        app.logger.error(f"Prediction error: {str(e)}")
        return jsonify({
            'error': str(e),
            'damage_score': -1  # Error indicator
        }), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check for Chainlink node"""
    return jsonify({
        'status': 'healthy',
        'model_loaded': True,
        'timestamp': int(time.time())
    })

if __name__ == '__main__':
    print("🔗 Starting Chainlink ML API Server...")
    print("📡 Endpoints:")
    print("   GET /predict?image_url=<url> - Damage prediction")
    print("   GET /health - Health check")
    
    # For production, use a proper WSGI server
    app.run(host='0.0.0.0', port=5000, debug=False)
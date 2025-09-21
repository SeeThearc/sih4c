"""
Test script specifically for your quick_model_FINAL.h5 model
"""

import requests
import json
import base64
import io
from PIL import Image
import numpy as np

def create_test_image():
    """Create a test fruit image"""
    # Create a test image that looks like fruit
    img = Image.new('RGB', (128, 128))
    pixels = img.load()
    
    # Create a simple fruit-like pattern
    for i in range(128):
        for j in range(128):
            # Create circular gradient (like an apple)
            center_x, center_y = 64, 64
            distance = ((i - center_x) ** 2 + (j - center_y) ** 2) ** 0.5
            
            if distance < 40:  # Fresh area
                pixels[i, j] = (200, 50, 50)  # Red
            elif distance < 50:  # Border
                pixels[i, j] = (150, 100, 50)  # Orange
            else:  # Background
                pixels[i, j] = (255, 255, 255)  # White
    
    return img

def image_to_base64(image):
    """Convert PIL image to base64"""
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG')
    img_bytes = buffer.getvalue()
    return base64.b64encode(img_bytes).decode('utf-8')

def test_your_model():
    """Test your model with various inputs"""
    base_url = "http://localhost:5000"
    
    print("🧪 Testing your quick_model_FINAL.h5 model")
    print("=" * 50)
    
    # Test 1: Health check
    print("\n1️⃣ Testing health endpoint...")
    try:
        response = requests.get(f"{base_url}/health")
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Health check passed")
            print(f"   Model loaded: {data.get('model_loaded')}")
            print(f"   Model info: {data.get('model_info', {})}")
        else:
            print(f"❌ Health check failed: {response.status_code}")
    except Exception as e:
        print(f"❌ Health check error: {e}")
    
    # Test 2: Model info
    print("\n2️⃣ Getting model information...")
    try:
        response = requests.get(f"{base_url}/model_info")
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Model info retrieved")
            print(f"   File: {data.get('model_file')}")
            print(f"   Exists: {data.get('model_exists')}")
            print(f"   Classes: {data.get('classes')}")
            print(f"   Input size: {data.get('input_size')}")
        else:
            print(f"❌ Model info failed: {response.status_code}")
    except Exception as e:
        print(f"❌ Model info error: {e}")
    
    # Test 3: Test with sample image
    print("\n3️⃣ Testing with sample image...")
    try:
        test_img = create_test_image()
        img_b64 = image_to_base64(test_img)
        
        response = requests.post(f"{base_url}/predict_base64", 
                               json={'image_data': img_b64})
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Image prediction successful")
            print(f"   Damage score: {data.get('damage_score')}%")
            print(f"   Prediction: {data.get('prediction')}")
            print(f"   Confidence: {data.get('confidence')}%")
        else:
            print(f"❌ Image prediction failed: {response.status_code}")
            print(f"   Error: {response.text}")
    except Exception as e:
        print(f"❌ Image prediction error: {e}")
    
    # Test 4: Hash-based prediction
    print("\n4️⃣ Testing hash-based prediction...")
    try:
        response = requests.get(f"{base_url}/predict_hash?hash=test123abc")
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Hash prediction successful")
            print(f"   Damage score: {data.get('damage_score')}%")
            print(f"   Prediction: {data.get('prediction')}")
        else:
            print(f"❌ Hash prediction failed: {response.status_code}")
    except Exception as e:
        print(f"❌ Hash prediction error: {e}")
    
    # Test 5: Simple prediction
    print("\n5️⃣ Testing simple prediction...")
    try:
        response = requests.get(f"{base_url}/predict_simple")
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Simple prediction successful")
            print(f"   Damage score: {data.get('damage_score')}%")
        else:
            print(f"❌ Simple prediction failed: {response.status_code}")
    except Exception as e:
        print(f"❌ Simple prediction error: {e}")
    
    print("\n" + "=" * 50)
    print("🎉 Testing completed!")

if __name__ == "__main__":
    print("Make sure your server is running: python chainlink_ml_server.py")
    input("Press Enter when server is ready...")
    test_your_model()
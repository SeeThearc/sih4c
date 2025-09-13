"""
Test suite for the Chainlink ML API Server
Run with: python -m pytest test_ml_server.py -v
"""

import pytest
import requests
import json
import time
from unittest.mock import Mock, patch, MagicMock
import numpy as np
import sys
import os

# Add the parent directory to path to import the server
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Mock TensorFlow before importing the server
class MockModel:
    def predict(self, image, verbose=0):
        # Return mock predictions [fresh_prob, rotten_prob]
        return np.array([[0.8, 0.2]])  # 80% fresh, 20% rotten

@patch('tensorflow.keras.models.load_model')
def test_ml_api_initialization(mock_load_model):
    """Test ML API initialization"""
    mock_load_model.return_value = MockModel()
    
    from chainlink_ml_server import ChainlinkMLAPI
    
    api = ChainlinkMLAPI()
    assert api.classes == ['fresh', 'rotten']
    assert api.input_size == (128, 128)
    assert api.request_count == 0

@patch('tensorflow.keras.models.load_model')
@patch('requests.get')
@patch('cv2.resize')
@patch('numpy.array')
class TestChainlinkMLAPI:
    """Test suite for ChainlinkMLAPI class"""
    
    def test_successful_prediction(self, mock_array, mock_resize, mock_requests, mock_load_model):
        """Test successful damage prediction"""
        # Setup mocks
        mock_load_model.return_value = MockModel()
        mock_response = Mock()
        mock_response.headers = {'content-type': 'image/jpeg'}
        mock_response.content = b'fake_image_data'
        mock_response.raise_for_status.return_value = None
        mock_requests.return_value = mock_response
        
        mock_array.return_value = np.ones((128, 128, 3))
        mock_resize.return_value = np.ones((128, 128, 3))
        
        from chainlink_ml_server import ChainlinkMLAPI
        api = ChainlinkMLAPI()
        
        result = api.predict_damage("https://example.com/tomato.jpg")
        
        assert result['prediction'] == 'fresh'
        assert result['damage_score'] == 20  # 100 - 80% fresh
        assert result['confidence'] == 80.0
        assert 'timestamp' in result
        assert result['model_version'] == 'v1.0'

    def test_rotten_prediction(self, mock_array, mock_resize, mock_requests, mock_load_model):
        """Test rotten fruit prediction"""
        # Setup for rotten prediction
        class RottenModel:
            def predict(self, image, verbose=0):
                return np.array([[0.3, 0.7]])  # 30% fresh, 70% rotten
        
        mock_load_model.return_value = RottenModel()
        
        # Setup other mocks
        mock_response = Mock()
        mock_response.headers = {'content-type': 'image/jpeg'}
        mock_response.content = b'fake_image_data'
        mock_response.raise_for_status.return_value = None
        mock_requests.return_value = mock_response
        
        mock_array.return_value = np.ones((128, 128, 3))
        mock_resize.return_value = np.ones((128, 128, 3))
        
        from chainlink_ml_server import ChainlinkMLAPI
        api = ChainlinkMLAPI()
        
        result = api.predict_damage("https://example.com/tomato.jpg")
        
        assert result['prediction'] == 'rotten'
        assert result['damage_score'] == 70
        assert result['confidence'] == 70.0

    def test_invalid_url_error(self, mock_array, mock_resize, mock_requests, mock_load_model):
        """Test handling of invalid URLs"""
        mock_load_model.return_value = MockModel()
        
        from chainlink_ml_server import ChainlinkMLAPI
        api = ChainlinkMLAPI()
        
        with pytest.raises(Exception) as exc_info:
            api.predict_damage("not-a-url")
        
        assert "Invalid URL format" in str(exc_info.value)

    def test_network_error_handling(self, mock_array, mock_resize, mock_requests, mock_load_model):
        """Test network error handling"""
        mock_load_model.return_value = MockModel()
        mock_requests.side_effect = requests.exceptions.RequestException("Network error")
        
        from chainlink_ml_server import ChainlinkMLAPI
        api = ChainlinkMLAPI()
        
        with pytest.raises(Exception) as exc_info:
            api.predict_damage("https://example.com/image.jpg")
        
        assert "Failed to download image" in str(exc_info.value)

    def test_non_image_content_type(self, mock_array, mock_resize, mock_requests, mock_load_model):
        """Test handling of non-image content"""
        mock_load_model.return_value = MockModel()
        
        mock_response = Mock()
        mock_response.headers = {'content-type': 'text/html'}
        mock_response.raise_for_status.return_value = None
        mock_requests.return_value = mock_response
        
        from chainlink_ml_server import ChainlinkMLAPI
        api = ChainlinkMLAPI()
        
        with pytest.raises(Exception) as exc_info:
            api.predict_damage("https://example.com/not-image.html")
        
        assert "does not point to an image" in str(exc_info.value)

# Flask App Tests
@patch('tensorflow.keras.models.load_model')
class TestFlaskAPI:
    """Test Flask API endpoints"""
    
    @pytest.fixture
    def client(self, mock_load_model):
        """Create test client"""
        mock_load_model.return_value = MockModel()
        
        from chainlink_ml_server import app
        app.config['TESTING'] = True
        with app.test_client() as client:
            yield client

    def test_health_endpoint(self, client, mock_load_model):
        """Test health check endpoint"""
        response = client.get('/health')
        assert response.status_code == 200
        
        data = json.loads(response.data)
        assert data['status'] == 'healthy'
        assert data['model_loaded'] is True
        assert data['chainlink_compatible'] is True

    def test_stats_endpoint(self, client, mock_load_model):
        """Test stats endpoint"""
        response = client.get('/stats')
        assert response.status_code == 200
        
        data = json.loads(response.data)
        assert 'total_predictions' in data
        assert 'model_info' in data
        assert data['model_info']['classes'] == ['fresh', 'rotten']

    @patch('requests.get')
    def test_predict_get_endpoint(self, mock_requests, client, mock_load_model):
        """Test GET prediction endpoint"""
        # Mock successful image download
        mock_response = Mock()
        mock_response.headers = {'content-type': 'image/jpeg'}
        mock_response.content = b'fake_image_data'
        mock_response.raise_for_status.return_value = None
        mock_requests.return_value = mock_response
        
        with patch('cv2.resize'), patch('numpy.array'):
            response = client.get('/predict?image_url=https://example.com/tomato.jpg')
            assert response.status_code == 200
            
            data = json.loads(response.data)
            assert 'damage_score' in data
            assert 'prediction' in data
            assert 'confidence' in data

    @patch('requests.get')
    def test_predict_post_endpoint(self, mock_requests, client, mock_load_model):
        """Test POST prediction endpoint"""
        # Mock successful image download
        mock_response = Mock()
        mock_response.headers = {'content-type': 'image/jpeg'}
        mock_response.content = b'fake_image_data'
        mock_response.raise_for_status.return_value = None
        mock_requests.return_value = mock_response
        
        with patch('cv2.resize'), patch('numpy.array'):
            response = client.post('/predict', 
                                 json={'image_url': 'https://example.com/tomato.jpg'})
            assert response.status_code == 200
            
            data = json.loads(response.data)
            assert 'damage_score' in data
            assert 'prediction' in data

    def test_predict_missing_url(self, client, mock_load_model):
        """Test prediction with missing image URL"""
        response = client.get('/predict')
        assert response.status_code == 400
        
        data = json.loads(response.data)
        assert 'error' in data
        assert data['damage_score'] == -1

    @patch('requests.get')
    def test_predict_error_handling(self, mock_requests, client, mock_load_model):
        """Test prediction error handling"""
        mock_requests.side_effect = requests.exceptions.RequestException("Network error")
        
        response = client.get('/predict?image_url=https://example.com/image.jpg')
        assert response.status_code == 500
        
        data = json.loads(response.data)
        assert 'error' in data
        assert data['damage_score'] == -1

# Integration Tests
@patch('tensorflow.keras.models.load_model')
class TestMLServerIntegration:
    """Integration tests for ML server"""
    
    def test_chainlink_response_format(self, mock_load_model):
        """Test Chainlink-compatible response format"""
        mock_load_model.return_value = MockModel()
        
        from chainlink_ml_server import ChainlinkMLAPI
        api = ChainlinkMLAPI()
        
        with patch('requests.get'), patch('cv2.resize'), patch('numpy.array'):
            result = api.predict_damage("https://example.com/test.jpg")
            
            # Verify all required fields for Chainlink
            required_fields = ['damage_score', 'prediction', 'confidence', 'timestamp', 'model_version']
            for field in required_fields:
                assert field in result
            
            # Verify damage_score is integer (gas efficient)
            assert isinstance(result['damage_score'], int)
            assert 0 <= result['damage_score'] <= 100

    def test_request_tracking(self, mock_load_model):
        """Test request count tracking"""
        mock_load_model.return_value = MockModel()
        
        from chainlink_ml_server import ChainlinkMLAPI
        api = ChainlinkMLAPI()
        
        initial_count = api.request_count
        
        with patch('requests.get'), patch('cv2.resize'), patch('numpy.array'):
            api.predict_damage("https://example.com/test1.jpg")
            api.predict_damage("https://example.com/test2.jpg")
        
        assert api.request_count == initial_count + 2

    def test_damage_score_boundaries(self, mock_load_model):
        """Test damage score boundary conditions"""
        class BoundaryModel:
            def __init__(self, fresh_prob):
                self.fresh_prob = fresh_prob
            
            def predict(self, image, verbose=0):
                return np.array([[self.fresh_prob, 1 - self.fresh_prob]])
        
        from chainlink_ml_server import ChainlinkMLAPI
        
        # Test extreme fresh (0% damage)
        mock_load_model.return_value = BoundaryModel(1.0)
        api = ChainlinkMLAPI()
        
        with patch('requests.get'), patch('cv2.resize'), patch('numpy.array'):
            result = api.predict_damage("https://example.com/fresh.jpg")
            assert result['damage_score'] == 0
            assert result['prediction'] == 'fresh'
        
        # Test extreme rotten (100% damage)
        mock_load_model.return_value = BoundaryModel(0.0)
        api = ChainlinkMLAPI()
        
        with patch('requests.get'), patch('cv2.resize'), patch('numpy.array'):
            result = api.predict_damage("https://example.com/rotten.jpg")
            assert result['damage_score'] == 100
            assert result['prediction'] == 'rotten'

# Performance Tests
@patch('tensorflow.keras.models.load_model')
class TestMLServerPerformance:
    """Performance tests for ML server"""
    
    def test_prediction_speed(self, mock_load_model):
        """Test prediction response time"""
        mock_load_model.return_value = MockModel()
        
        from chainlink_ml_server import ChainlinkMLAPI
        api = ChainlinkMLAPI()
        
        with patch('requests.get'), patch('cv2.resize'), patch('numpy.array'):
            start_time = time.time()
            api.predict_damage("https://example.com/test.jpg")
            end_time = time.time()
            
            # Should complete within reasonable time (adjust as needed)
            assert (end_time - start_time) < 1.0  # 1 second max

    def test_concurrent_requests(self, mock_load_model):
        """Test handling of multiple concurrent requests"""
        mock_load_model.return_value = MockModel()
        
        from chainlink_ml_server import app
        app.config['TESTING'] = True
        
        with app.test_client() as client:
            with patch('requests.get'), patch('cv2.resize'), patch('numpy.array'):
                # Simulate multiple requests
                responses = []
                for i in range(5):
                    response = client.get(f'/predict?image_url=https://example.com/test{i}.jpg')
                    responses.append(response)
                
                # All should succeed
                for response in responses:
                    assert response.status_code == 200

# Error Recovery Tests
@patch('tensorflow.keras.models.load_model')
class TestMLServerErrorRecovery:
    """Test error recovery scenarios"""
    
    def test_model_failure_recovery(self, mock_load_model):
        """Test recovery from model prediction failures"""
        class FailingModel:
            def predict(self, image, verbose=0):
                raise Exception("Model prediction failed")
        
        mock_load_model.return_value = FailingModel()
        
        from chainlink_ml_server import ChainlinkMLAPI
        api = ChainlinkMLAPI()
        
        with patch('requests.get'), patch('cv2.resize'), patch('numpy.array'):
            with pytest.raises(Exception) as exc_info:
                api.predict_damage("https://example.com/test.jpg")
            
            assert "Prediction failed" in str(exc_info.value)

    def test_image_processing_failure(self, mock_load_model):
        """Test recovery from image processing failures"""
        mock_load_model.return_value = MockModel()
        
        from chainlink_ml_server import ChainlinkMLAPI
        api = ChainlinkMLAPI()
        
        with patch('requests.get') as mock_requests:
            mock_response = Mock()
            mock_response.headers = {'content-type': 'image/jpeg'}
            mock_response.content = b'corrupted_image_data'
            mock_response.raise_for_status.return_value = None
            mock_requests.return_value = mock_response
            
            with patch('PIL.Image.open', side_effect=Exception("Corrupted image")):
                with pytest.raises(Exception) as exc_info:
                    api.predict_damage("https://example.com/corrupted.jpg")
                
                assert "Failed to process image" in str(exc_info.value)

if __name__ == "__main__":
    # Run tests if script is executed directly
    pytest.main([__file__, "-v"])
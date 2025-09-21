import random
import os
from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Enable CORS for cross-origin requests

@app.route('/sensor', methods=['GET'])
def get_sensor_data():
    # Simulate more realistic temperature data
    temp = round(random.uniform(-5.0, 35.0), 2)  # Wider range including below minimum
    
    response = {
        'temperature': temp,
        'timestamp': int(time.time()),
        'sensor_id': 'TEMP_001',
        'status': 'active'
    }
    
    return jsonify(response)

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'service': 'temperature-sensor'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=False)
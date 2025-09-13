import requests
import time

def test_rotten_produce():
    """Test with verified rotten/damaged produce images"""
    
    rotten_test_cases = [
        {
            "url": "https://images.unsplash.com/photo-1509440191306-b89024c38816?ixlib=rb-4.0.3&w=500&q=80&auto=format&fit=crop",
            "description": "Moldy/rotten apple",
            "expected_damage_score": "high"
        },
        {
            "url": "https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?ixlib=rb-4.0.3&w=500&q=80&auto=format&fit=crop",
            "description": "Overripe brown bananas", 
            "expected_damage_score": "high"
        },
        {
            "url": "https://images.unsplash.com/photo-1583258292688-d0213dc5db2e?ixlib=rb-4.0.3&w=500&q=80&auto=format&fit=crop",
            "description": "Very ripe/spotted bananas",
            "expected_damage_score": "medium-high"
        },
        {
            "url": "https://images.unsplash.com/photo-1434819801346-2c1c1fdcab3b?ixlib=rb-4.0.3&w=500&q=80&auto=format&fit=crop",
            "description": "Wilted lettuce",
            "expected_damage_score": "medium"
        },
        {
            "url": "https://images.unsplash.com/photo-1565299624946-b28f40a0ca4b?ixlib=rb-4.0.3&w=500&q=80&auto=format&fit=crop",
            "description": "Cut/damaged apple showing browning",
            "expected_damage_score": "medium"
        }
    ]
    
    print("🧪 Testing Rotten/Damaged Produce for Supply Chain:")
    print("=" * 60)
    
    results = []
    
    for i, test_case in enumerate(rotten_test_cases, 1):
        print(f"\n🍎 Rotten Test {i}: {test_case['description']}")
        print(f"Expected damage level: {test_case['expected_damage_score']}")
        
        # Test the URL first
        try:
            check_response = requests.head(test_case['url'], timeout=10)
            if check_response.status_code != 200:
                print(f"❌ URL broken: {check_response.status_code}")
                continue
        except Exception as e:
            print(f"❌ URL check failed: {e}")
            continue
            
        # Test prediction
        api_url = f"http://127.0.0.1:5000/predict?image_url={test_case['url']}"
        
        try:
            response = requests.get(api_url, timeout=30)
            
            if response.status_code == 200:
                result = response.json()
                prediction = result['prediction']
                confidence = result['confidence']
                damage_score = result['damage_score']
                
                # Determine if result makes sense for rotten produce
                if prediction == "rotten" and damage_score > 50:
                    status = "✅ CORRECT"
                elif prediction == "rotten":
                    status = "⚠️  ROTTEN but low damage score"
                else:
                    status = "❌ WRONG - should be rotten"
                
                print(f"{status}")
                print(f"📊 Damage Score: {damage_score}/100")
                print(f"🎯 Confidence: {confidence}%")
                print(f"🔍 Prediction: {prediction}")
                
                # Store result for analysis
                results.append({
                    'description': test_case['description'],
                    'prediction': prediction,
                    'damage_score': damage_score,
                    'confidence': confidence,
                    'url': test_case['url']
                })
                
            else:
                print(f"❌ API Error {response.status_code}: {response.text}")
                
        except Exception as e:
            print(f"❌ Request failed: {e}")
        
        time.sleep(1)  # Rate limiting
    
    # Summary analysis
    print("\n" + "="*60)
    print("📊 ROTTEN PRODUCE TEST SUMMARY:")
    print("="*60)
    
    correct_predictions = sum(1 for r in results if r['prediction'] == 'rotten')
    total_tests = len(results)
    
    print(f"✅ Correct 'rotten' predictions: {correct_predictions}/{total_tests}")
    print(f"📈 Success rate: {(correct_predictions/total_tests)*100:.1f}%" if total_tests > 0 else "No successful tests")
    
    high_damage_scores = sum(1 for r in results if r['damage_score'] > 70)
    print(f"🔥 High damage scores (>70): {high_damage_scores}/{total_tests}")
    
    # Show problematic results
    problematic = [r for r in results if r['prediction'] != 'rotten' or r['damage_score'] < 50]
    if problematic:
        print(f"\n⚠️  PROBLEMATIC RESULTS:")
        for prob in problematic:
            print(f"   - {prob['description']}: {prob['prediction']} ({prob['damage_score']}/100)")
    
    return results

if __name__ == "__main__":
    # Check server health first
    try:
        health = requests.get("http://127.0.0.1:5000/health", timeout=5)
        print(f"🟢 Server Status: {health.json()}")
        print("Starting rotten produce tests...\n")
        
        results = test_rotten_produce()
        
    except Exception as e:
        print("❌ Server not running! Start your Flask app first:")
        print("python chainlink_ml_api.py")
        print(f"Error: {e}")
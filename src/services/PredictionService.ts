import * as tf from '@tensorflow/tfjs';

// Simple sequential model to predict next optimal BPM based on history
class PredictionService {
    private model: tf.Sequential;
    private isTrained = false;

    constructor() {
        this.model = tf.sequential();
        this.model.add(tf.layers.dense({ units: 16, inputShape: [3], activation: 'relu' }));
        this.model.add(tf.layers.dense({ units: 1 }));
        this.model.compile({ optimizer: 'sgd', loss: 'meanSquaredError' });
    }

    async trainOnHistory(history: { bpm: number, energy: number, duration: number, nextBpm: number }[]) {
        if (history.length === 0) return;

        const inputs = history.map(h => [h.bpm / 200, h.energy, h.duration / 600]);
        const outputs = history.map(h => h.nextBpm / 200);

        const xs = tf.tensor2d(inputs);
        const ys = tf.tensor2d(outputs, [outputs.length, 1]);

        await this.model.fit(xs, ys, { epochs: 10 });
        this.isTrained = true;

        xs.dispose();
        ys.dispose();
        console.log("TF.js Model Trained");
    }

    predictNextBPM(currentBpm: number, energy: number, duration: number): number {
        if (!this.isTrained) return currentBpm;

        const input = tf.tensor2d([[currentBpm / 200, energy, duration / 600]]);
        const prediction = this.model.predict(input) as tf.Tensor;
        const result = prediction.dataSync()[0] * 200;

        input.dispose();
        prediction.dispose();

        return Math.round(result);
    }
}

export const predictionService = new PredictionService();

# Disease model v2

Put the two files from `ml/disease/train_disease_v2.ipynb` here:

- `disease_v2.onnx`: the field-trained model (input `image` [N,3,224,224], output `logits`)
- `labels.json`: its classes, calibration temperature and input geometry

The server uses them as soon as both are present and agree with each other. Otherwise it keeps using the v1 model one folder up. Run `npm run seed:diseases` after adding them so the reference library has the new classes.

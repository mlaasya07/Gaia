"""Train separate ZeMA component-condition baselines; saves metrics and model artifacts."""
import argparse, itertools, json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score, classification_report, confusion_matrix
from sklearn.preprocessing import StandardScaler
import joblib
from .zema import cycle_features

TARGETS = ["cooler_condition", "valve_condition", "pump_leakage", "accumulator_pressure"]

def _grouped_splits(y, groups, seed):
    splitter=StratifiedGroupKFold(n_splits=10, shuffle=True, random_state=seed)
    folds=list(splitter.split(np.zeros(len(y)), y, groups))
    for test_fold, validation_fold in itertools.combinations(range(len(folds)), 2):
        test_idx=folds[test_fold][1]
        validation_idx=folds[validation_fold][1]
        train_idx=np.concatenate([indexes for fold_number, (_, indexes) in enumerate(folds)
                                  if fold_number not in {test_fold, validation_fold}])
        if (y.iloc[train_idx].nunique()==y.nunique()
                and y.iloc[validation_idx].nunique()==y.nunique()
                and y.iloc[test_idx].nunique()==y.nunique()):
            return train_idx, validation_idx, test_idx
    raise ValueError("Could not find grouped train/validation/test folds with every target class.")


def train_maintenance(data_source, out_dir="outputs/maintenance", seed=42):
    X, y=cycle_features(data_source)
    out=Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    X.to_csv(out/"zema_cycle_features.csv", index=False)
    y.to_csv(out/"zema_targets.csv", index=False)
    groups=np.arange(len(X))//64
    all_metrics={}
    for target in TARGETS:
        yy=y[target]
        train_idx,validation_idx,test_idx=_grouped_splits(yy,groups,seed)
        model=Pipeline([
            ("imputer",SimpleImputer(strategy="median")),
            ("scaler",StandardScaler()),
            ("rf",RandomForestClassifier(n_estimators=250, class_weight="balanced_subsample",
                                         random_state=seed, n_jobs=-1, min_samples_leaf=2))
        ])
        model.fit(X.iloc[train_idx],yy.iloc[train_idx])
        validation_pred=model.predict(X.iloc[validation_idx])
        model.fit(X.iloc[np.concatenate([train_idx,validation_idx])],yy.iloc[np.concatenate([train_idx,validation_idx])])
        pred=model.predict(X.iloc[test_idx])
        name=target
        joblib.dump(model,out/f"{name}_rf.joblib")
        labels=sorted(yy.unique())
        report=classification_report(yy.iloc[test_idx],pred,labels=labels,output_dict=True,zero_division=0)
        metrics={"target":target,"n_train":len(train_idx),"n_validation":len(validation_idx),"n_test":len(test_idx),
                 "train_class_counts":{str(k):int(v) for k,v in yy.iloc[train_idx].value_counts().items()},
                 "validation_accuracy":float(accuracy_score(yy.iloc[validation_idx],validation_pred)),
                 "validation_macro_f1":float(f1_score(yy.iloc[validation_idx],validation_pred,average="macro",zero_division=0)),
                 "test_accuracy":float(accuracy_score(yy.iloc[test_idx],pred)),
                 "test_macro_f1":float(f1_score(yy.iloc[test_idx],pred,average="macro",zero_division=0)),
                 "classification_report":report,
                 "confusion_matrix":confusion_matrix(yy.iloc[test_idx],pred,labels=labels).tolist(),
                 "labels":[str(v) for v in labels]}
        all_metrics[target]=metrics
    result={"source":str(data_source),"rows":len(X),"features":X.shape[1],
            "split_strategy":"contiguous 64-cycle groups; disjoint stratified train/validation/test folds",
            "seed":seed,"targets":all_metrics}
    with open(out/"metrics.json","w",encoding="utf-8") as f: json.dump(result,f,indent=2,default=str)
    return result

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--data",default=None,help="ZeMA ZIP archive or extracted data directory.")
    parser.add_argument("--data-dir",default="data/raw/zema",help="Legacy extracted data directory.")
    parser.add_argument("--out-dir",default="outputs/maintenance")
    parser.add_argument("--seed",type=int,default=42)
    args=parser.parse_args()
    data_source=args.data or args.data_dir
    result=train_maintenance(data_source,args.out_dir,args.seed)
    print(f"Saved models and metrics to {Path(args.out_dir).resolve()}")
    for target,metrics in result["targets"].items():
        print(f"{target}: test accuracy={metrics['test_accuracy']:.4f}, test macro-F1={metrics['test_macro_f1']:.4f}")
    print("These are measured ZeMA baseline results, not ML2MAS paper-reported scores.")
if __name__=="__main__": main()

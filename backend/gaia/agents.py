"""Baseline policies and a transparent LACD-inspired decentralized prototype."""
def act_centralized(obs):
    health,backlog,price,carbon,workload,edge_load,_=obs
    maintenance=int(health<.55)
    production=min(1.,max(.2,.55+.35*backlog-.15*(price>1.15)))
    return {"production":production,"maintenance":maintenance,"cloud":int(edge_load>.75 and carbon<.5),"shift":int(carbon>.72 and backlog<.8)}

def act_independent(obs):
    health,backlog,price,carbon,workload,edge_load,_=obs
    # Agents act independently; there is no coordination term.
    return {"production":min(1.,max(.15,.48+.22*backlog+.10*workload)),
            "maintenance":int(health<.40),
            "cloud":int(edge_load>.75 and carbon<.65),
            "shift":int((carbon>.80 or price>1.25) and backlog<.8)}

def _monitoring_agent(health):
    health_risk = float(min(1., max(0., 1. - health)))
    return {"health_risk": health_risk, "maintenance_alarm": int(health_risk > .45)}

def _scheduling_agent(backlog, workload, monitoring_message):
    production = min(1., max(.15, .48 + .28 * backlog + .12 * workload
                             - .20 * monitoring_message["maintenance_alarm"]))
    return {"production": production, "backlog_pressure": min(1., backlog / 2.)}

def _maintenance_agent(monitoring_message, backlog):
    urgent = monitoring_message["health_risk"] > .70
    maintenance = int(urgent or (monitoring_message["maintenance_alarm"] and backlog < 1.1))
    return {"maintenance": maintenance, "production_cap": .72 if maintenance and not urgent else 1.}

def _energy_agent(price, carbon, backlog):
    production_cap = .70 if price > 1.15 else .82 if carbon > .80 else 1.
    shift = int((carbon > .72 or price > 1.25) and backlog < .8)
    return {"production_cap": production_cap, "shift": shift}

def _edge_cloud_agent(edge_load):
    return {"cloud_request": int(edge_load > .65)}

def act_lacd_prototype(obs):
    """Simulate decentralized agents exchanging proposals, not raw sensor readings."""
    health,backlog,price,carbon,workload,edge_load,_=obs
    monitoring_message = _monitoring_agent(health)
    messages = {
        "monitoring": monitoring_message,
        "scheduling": _scheduling_agent(backlog, workload, monitoring_message),
        "maintenance": _maintenance_agent(monitoring_message, backlog),
        "energy": _energy_agent(price, carbon, backlog),
        "edge_cloud": _edge_cloud_agent(edge_load),
    }
    # Agents reach a simple consensus by honoring the tightest production constraint.
    production = min(messages["scheduling"]["production"],
                     messages["maintenance"]["production_cap"],
                     messages["energy"]["production_cap"])
    shift = messages["energy"]["shift"] if messages["scheduling"]["backlog_pressure"] < .5 else 0
    cloud = int(messages["edge_cloud"]["cloud_request"] and carbon < .65)
    return {"production":production,"maintenance":messages["maintenance"]["maintenance"],
            "cloud":cloud,"shift":shift}

act_coordinated_prototype = act_lacd_prototype

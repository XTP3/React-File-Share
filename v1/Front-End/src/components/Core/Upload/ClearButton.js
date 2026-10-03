import './ClearButton.css';

function ActiveClearButton(props) {
    return (
        <div className="ActiveClearButton" onClick={props.onClick}>
            <ion-icon name={props.iconName}></ion-icon>
        </div>
    );
}

function InactiveClearButton(props) {
    return (
        <div className="InactiveClearButton">
            <ion-icon name={props.iconName}></ion-icon>
        </div>
    );
}

function ClearButton(props) {
    let active = props.active;
    let iconName = props.iconName;
    let onClick = props.onClick;

    if(active) {
        return <ActiveClearButton iconName={iconName} onClick={onClick} />;

    }else {
        return <InactiveClearButton iconName={iconName} />;
    }
}

export default ClearButton;
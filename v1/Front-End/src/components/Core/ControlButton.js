import './ControlButton.css';

function ActiveControlButton(props) {
    return (
        <li className="ActiveControlButton" onClick={props.onClick}>
            <ion-icon name={props.iconName}></ion-icon>
        </li>
    );
}

function InactiveControlButton(props) {
    return (
        <li className="InactiveControlButton" onClick={props.onClick}>
            <ion-icon name={props.iconName}></ion-icon>
        </li>
    );
}

function ControlButton(props) {
    let active = props.active;

    if(active) {
        return <ActiveControlButton iconName={props.iconName} onClick={props.onClick} />;

    }else {
        return <InactiveControlButton iconName={props.iconName} onClick={props.onClick} />;
    }
}

export default ControlButton;
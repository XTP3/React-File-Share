import './SortButton.css';

function SortButton(props) { 
    return (
        <div className="Sort">
            <div className="SortButton" onClick={props.onClick}>
                <ion-icon name="funnel-outline"></ion-icon>
                <span className="Title" id="SortTitle">Sort</span>
            </div>
            <div className="DropdownMenu" id="DropdownMenu">
                <span onClick={props.dropDownOne}>Alphabetical</span>
                <span onClick={props.dropDownTwo}>Chronological</span>
                <span onClick={props.dropDownThree}>Size</span>
            </div>
        </div>
    );
}

export default SortButton;